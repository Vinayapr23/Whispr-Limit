import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { WhisprLimit } from "../target/types/whispr_limit";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  createSyncNativeInstruction,
  Account,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Commitment,
  SetComputeUnitLimitParams,
  ComputeBudgetProgram,
} from "@solana/web3.js";
const commitment: Commitment = "confirmed";

describe("WhisprLimit", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.WhisprLimit as Program<WhisprLimit>;
  const provider = anchor.getProvider();
  const connection = provider.connection;

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);

    return event;
  };

  const arciumEnv = getArciumEnv();

  // Helper function to log a message
  const log = async (signature: string): Promise<string> => {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}\n`
    );
    return signature;
  };

  const confirmTx = async (signature: string) => {
    const latestBlockhash = await anchor
      .getProvider()
      .connection.getLatestBlockhash();
    await anchor.getProvider().connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      commitment
    );
  };

  const confirmTxs = async (signatures: string[]) => {
    await Promise.all(signatures.map(confirmTx));
  };

  // Helper function to log the transaction signature
  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    await log(signature);
    return signature;
  };

  // Address of the Raydium Cpmm program on devnet
  const CPMM_PROGRAM_ID = new anchor.web3.PublicKey(
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
  );
  // Address of the Locking CPMM program on devnet
  const LOCK_CPMM_PROGRAM_ID = new anchor.web3.PublicKey(
    "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE"
  );

  // Address of the Locking CPMM program on devnet
  const LOCK_CPMM_AUTHORITY_ID = new anchor.web3.PublicKey(
    "3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"
  );

  // Address of the Raydium AMM configuration account on mainnet
  const AMM_CONFIG_ID = new anchor.web3.PublicKey(
    "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2"
  );

  // Address of the Token Metadata program
  const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const MEMO_PROGRAM = new anchor.web3.PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
  );

  // Address of the Rent program
  const RENT_PROGRAM = anchor.web3.SYSVAR_RENT_PUBKEY;

  // Create pool fee receiver
  // Mainnet DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8
  // Devnet G11FKBRaAkHAKuLCgLM6K6NUc9rTjPAznRCjZifrTQe2
  const create_pool_fee = new anchor.web3.PublicKey(
    "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"
  );

  const WSOL_ID = new anchor.web3.PublicKey(
    "So11111111111111111111111111111111111111112"
  );
  // Define keypairs for different roles
  const [creator, token_mint, fee_nft_mint] = [
    new Keypair(),
    new Keypair(),
    new Keypair(),
  ];

  // This variable is the base vault account.
  let creator_base_ata: PublicKey;

  // This variable is the token vault account.
  let creator_token_ata: PublicKey;

  // Raydium Observation State PDA
  let observation_state: PublicKey;

  // Raydium Pool PDA
  let pool_state: PublicKey;

  // Raydium Pool vault and lp mint authority PDA
  let authority: PublicKey;

  // Raydium base mint vault & token mint vault
  let token_vault_0: PublicKey;
  let token_vault_1: PublicKey;

  // Raydium lp_mint
  let lp_mint: PublicKey;

  // lp mint ata
  let lp_mint_ata: PublicKey;

  // nft_mint_acc locked
  let nft_mint_acc: PublicKey;

  // locked pda
  let locked_liquidity: PublicKey;

  // locked pda
  let locked_lp_vault: PublicKey;

  const metadata = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      fee_nft_mint.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];

  it("Airdrop\n", async () => {
    await Promise.all(
      [creator].map(async (k) => {
        return await anchor
          .getProvider()
          .connection.requestAirdrop(
            k.publicKey,
            100 * anchor.web3.LAMPORTS_PER_SOL
          );
      })
    ).then(confirmTxs);

    // PDA address for the pool_state
    pool_state = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        AMM_CONFIG_ID.toBuffer(),
        WSOL_ID.toBuffer(),
        token_mint.publicKey.toBuffer(),
      ],
      CPMM_PROGRAM_ID
    )[0];

    observation_state = PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), pool_state.toBuffer()],
      CPMM_PROGRAM_ID
    )[0];

    // PDA address for the token vault for token0 (WSOL)
    token_vault_0 = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), pool_state.toBuffer(), WSOL_ID.toBuffer()],
      CPMM_PROGRAM_ID
    )[0];

    // PDA address for the token vault for token1 (mint)
    token_vault_1 = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        pool_state.toBuffer(),
        token_mint.publicKey.toBuffer(),
      ],
      CPMM_PROGRAM_ID
    )[0];

    // Pda address for the Raydium vault lp auth
    authority = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_and_lp_mint_auth_seed")],
      CPMM_PROGRAM_ID
    )[0];

    lp_mint = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_lp_mint"), pool_state.toBuffer()],
      CPMM_PROGRAM_ID
    )[0];

    // PDA address for the pool_state
    locked_liquidity = PublicKey.findProgramAddressSync(
      [Buffer.from("locked_liquidity"), fee_nft_mint.publicKey.toBuffer()],
      LOCK_CPMM_PROGRAM_ID
    )[0];

    creator_base_ata = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        WSOL_ID,
        creator.publicKey
      )
    ).address;
    // Amount of SOL to wrap (2 SOL in lamports)
    const amountToWrap = 2 * anchor.web3.LAMPORTS_PER_SOL;

    // Send transaction to wrap SOL
    const wrapTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: creator.publicKey, // Sender (creator)
        toPubkey: creator_base_ata, // Associated token account for WSOL
        lamports: amountToWrap, // Amount to transfer (2 SOL)
      }),
      createSyncNativeInstruction(creator_base_ata) // Sync native balance with token balance
    );
    // Sign and send the transaction
    await anchor.web3.sendAndConfirmTransaction(connection, wrapTx, [creator]);

    console.log("Wrapped 2 SOL into WSOL at:", creator_base_ata.toBase58());

    creator_token_ata = getAssociatedTokenAddressSync(
      token_mint.publicKey,
      creator.publicKey
    );

    nft_mint_acc = getAssociatedTokenAddressSync(
      fee_nft_mint.publicKey,
      creator.publicKey
    );

    lp_mint_ata = getAssociatedTokenAddressSync(lp_mint, creator.publicKey);

    locked_lp_vault = getAssociatedTokenAddressSync(
      lp_mint,
      LOCK_CPMM_AUTHORITY_ID,
      true
    );
  });
  let [lookupTableInst, lookupTableAddress]: [
    anchor.web3.TransactionInstruction,
    anchor.web3.PublicKey
  ] = [null, null];
  let lookupTableAccount: anchor.web3.AddressLookupTableAccount = null;
  // It creates an ALT
  //   it("Initialize ALT \n", async () => {

  //     const slot = await connection.getSlot();

  //     [lookupTableInst, lookupTableAddress] =
  //       anchor.web3.AddressLookupTableProgram.createLookupTable({
  //         authority: creator.publicKey,
  //         payer: creator.publicKey,
  //         recentSlot: slot,
  //       });

  //     const extendInstruction = anchor.web3.AddressLookupTableProgram.extendLookupTable({
  //       payer: creator.publicKey,
  //       authority: creator.publicKey,
  //       lookupTable: lookupTableAddress,
  //       addresses: [
  //         SystemProgram.programId,
  //         program.programId,
  //         TOKEN_PROGRAM_ID,
  //         ASSOCIATED_TOKEN_PROGRAM_ID,
  //         TOKEN_METADATA_PROGRAM_ID,
  //         CPMM_PROGRAM_ID,
  //         RENT_PROGRAM,
  //         create_pool_fee,
  //         AMM_CONFIG_ID,
  //         WSOL_ID
  //         // list more publicKey addresses here
  //       ],
  //     });
  //     lookupTableAccount = (
  //       await connection.getAddressLookupTable(lookupTableAddress)
  //     ).value;

  //     // fetching the latest blockhash
  //     let blockhash = await connection
  //       .getLatestBlockhash()
  //       .then(res => res.blockhash);

  //     lookupTableAccount = (
  //       await connection.getAddressLookupTable(lookupTableAddress)
  //     ).value;

  //     // creating a versioned message instead of leagacy
  //     const messageV0 = new anchor.web3.TransactionMessage({
  //       payerKey: creator.publicKey,
  //       recentBlockhash: blockhash,
  //       instructions: [lookupTableInst, extendInstruction]
  //     }).compileToV0Message([])

  //     // creating a versioned tx and using that to sendTransaction to avoid deprecation
  //     const transaction = new anchor.web3.VersionedTransaction(messageV0);

  //     // sign your transaction with the required `Signers`
  //     transaction.sign([creator]);

  //     // Step 3: Send and confirm the transaction with rpc skip preflight
  //     const sig = await
  //       anchor.getProvider()
  //         .connection
  //         // since we have already signed the tx, no need to pass the signers array again
  //         .sendTransaction(
  //           transaction,
  //           {
  //             skipPreflight: true,
  //           }
  //         )
  //     // Confirm txn
  //     await confirm(sig);

  //     await new Promise(f => setTimeout(f, 1000));
  //   });

  //  // Test to create a raydium cpmm pool
  //  it("Creates a Raydium cpmm pool and Locks the Lp", async () => {

  //   const createCpmmPool = await program.methods
  //     .createCpmmPool(
  //       null
  //   )
  //     .accountsPartial({
  //       cpSwapProgram: CPMM_PROGRAM_ID,
  //       creator: creator.publicKey,
  //       ammConfig: AMM_CONFIG_ID,
  //       authority: authority,
  //       poolState: pool_state,
  //       baseMint: WSOL_ID,
  //       tokenMint: token_mint.publicKey,
  //       lpMint: lp_mint,
  //       creatorBaseAta: creator_base_ata,
  //       creatorTokenAta: creator_token_ata,
  //       creatorLpToken: lp_mint_ata,
  //       token0Vault: token_vault_0,
  //       token1Vault: token_vault_1,
  //       createPoolFee: create_pool_fee,
  //       observationState: observation_state,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       token1Program: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //       rent: RENT_PROGRAM

  //     })
  //     .signers([creator, token_mint])
  //     .instruction()

  //   const lockCpiIx = await program.methods
  //     .lockCpmmLiquidity(
  //   )
  //     .accountsPartial({
  //       cpSwapProgram: CPMM_PROGRAM_ID,
  //       lockCpmmProgram: LOCK_CPMM_PROGRAM_ID,
  //       creator: creator.publicKey,
  //       ammConfig: AMM_CONFIG_ID,
  //       authority: LOCK_CPMM_AUTHORITY_ID,
  //       feeNftMint: fee_nft_mint.publicKey,
  //       feeNftAcc: nft_mint_acc,
  //       poolState: pool_state,
  //       lockedLiquidity: locked_liquidity,
  //       lpMint: lp_mint,
  //       liquidityOwnerLp: lp_mint_ata,
  //       lockedLpVault: locked_lp_vault,
  //       token0Vault: token_vault_0,
  //       token1Vault: token_vault_1,
  //       metadata: metadata,
  //       metadataProgram: TOKEN_METADATA_PROGRAM_ID,
  //       associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //       rent: RENT_PROGRAM,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       baseMint: WSOL_ID,
  //       tokenMint: token_mint.publicKey

  //     })
  //     .signers([creator, fee_nft_mint]) // Signer of the transaction
  //     .instruction()

  //     let blockhash = await connection
  //     .getLatestBlockhash()
  //     .then(res => res.blockhash);

  //   const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 } as SetComputeUnitLimitParams);

  //   lookupTableAccount = (
  //     await connection.getAddressLookupTable(lookupTableAddress)
  //   ).value;

  //   // creating a versioned message instead of leagacy
  //   const messageV0 = new anchor.web3.TransactionMessage({
  //     payerKey: creator.publicKey,
  //     recentBlockhash: blockhash,
  //     instructions: [setComputeUnitLimitIx, createCpmmPool, lockCpiIx]
  //   }).compileToV0Message([lookupTableAccount])

  //   // creating a versioned tx and using that to sendTransaction to avoid deprecation
  //   const transaction = new anchor.web3.VersionedTransaction(messageV0);

  //   // sign your transaction with the required `Signers`
  //   transaction.sign([creator, token_mint, fee_nft_mint]);
  //   // Step 3: Send and confirm the transaction with rpc skip preflight
  //   const sig = await
  //     anchor.getProvider()
  //       .connection
  //       // since we have already signed the tx, no need to pass the signers array again
  //       .sendTransaction(
  //         transaction,
  //         {
  //           skipPreflight: true,
  //         }
  //       )
  //   // Confirm txn
  //   await confirm(sig);
  // });

  // // Comprehensive monitoring including SOL balance and pool state
  // const getComprehensiveStatus = async (title: string) => {
  //   console.log(`\n💰 === ${title} ===`);

  //   try {
  //     // 1. User SOL balance
  //     const solBalance = await connection.getBalance(creator.publicKey);
  //     console.log(`User SOL Balance: ${solBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  //     // 2. User token balances
  //     const wsolBalance = await connection.getTokenAccountBalance(creator_base_ata);
  //     const tokenBalance = await connection.getTokenAccountBalance(creator_token_ata);
  //     console.log(`User WSOL: ${wsolBalance.value.uiAmountString || wsolBalance.value.amount}`);
  //     console.log(`User Tokens: ${tokenBalance.value.uiAmountString || tokenBalance.value.amount}`);

  //     // 3. Pool vault balances
  //     const vault0 = await connection.getTokenAccountBalance(token_vault_0);
  //     const vault1 = await connection.getTokenAccountBalance(token_vault_1);
  //     console.log(`Pool WSOL Vault: ${vault0.value.amount}`);
  //     console.log(`Pool Token Vault: ${vault1.value.amount}`);

  //     // 4. LP token info
  //     try {
  //       const lpBalance = await connection.getTokenAccountBalance(lp_mint_ata);
  //       console.log(`User LP Tokens: ${lpBalance.value.amount}`);
  //     } catch (e) {
  //       console.log(`User LP Tokens: Account not found or 0`);
  //     }

  //     // 5. Pool state account info (if you want to see raw pool data)
  //     const poolAccountInfo = await connection.getAccountInfo(pool_state);
  //     if (poolAccountInfo) {
  //       console.log(`Pool State Account Size: ${poolAccountInfo.data.length} bytes`);
  //       console.log(`Pool State Owner: ${poolAccountInfo.owner.toBase58()}`);
  //     }

  //   } catch (error) {
  //     console.log(`Error getting comprehensive status: ${error}`);
  //   }

  //   console.log(`================================\n`);
  // };

  // // Usage in your test:
  // it("Swap with Comprehensive Monitoring", async () => {
  //   try {
  //     // Monitor BEFORE
  //     await getComprehensiveStatus("BEFORE SWAP");

  //     let amount_in = new BN(100000);
  //     await new Promise(f => setTimeout(f, 1000));

  //     const swapIx = await program.methods
  //       .swap(amount_in, new BN(500))
  //       .accountsPartial({
  //         cpSwapProgram: CPMM_PROGRAM_ID,
  //         creator: creator.publicKey,
  //         authority: authority,
  //         ammConfig: AMM_CONFIG_ID,
  //         poolState: pool_state,
  //         inputTokenAccount: creator_base_ata,
  //         outputTokenAccount: creator_token_ata,
  //         inputVault: token_vault_0,
  //         outputVault: token_vault_1,
  //         inputTokenProgram: TOKEN_PROGRAM_ID,
  //         outputTokenProgram: TOKEN_PROGRAM_ID,
  //         inputTokenMint: WSOL_ID,
  //         outputTokenMint: token_mint.publicKey,
  //         observationState: observation_state
  //       })
  //       .signers([creator])
  //       .rpc({ skipPreflight: true })
  //       .then(confirm);

  //     // Monitor AFTER
  //     await getComprehensiveStatus("AFTER SWAP");

  //     console.log(`✅ Swap completed successfully!`);
  //     console.log(`📝 Transaction: ${swapIx}`);

  //   } catch (error) {
  //     console.error("UNIT TEST *Swap* ERROR -", error.message);
  //   }
  // });

  //   // CPI Swap
  //   it("Swap", async () => {
  //     try {

  //     let amount_in = new BN(100000);
  //     await new Promise(f => setTimeout(f, 1000));
  //     const swapIx = await program.methods
  //       .swap(amount_in, new BN(500)
  //     )
  //       .accountsPartial({
  //         cpSwapProgram: CPMM_PROGRAM_ID,
  //         creator: creator.publicKey,
  //         authority: authority,
  //         ammConfig: AMM_CONFIG_ID,
  //         poolState: pool_state,
  //         inputTokenAccount: creator_base_ata,
  //         outputTokenAccount: creator_token_ata,
  //         inputVault: token_vault_0,
  //         outputVault: token_vault_1,
  //         inputTokenProgram: TOKEN_PROGRAM_ID,
  //         outputTokenProgram: TOKEN_PROGRAM_ID,
  //         inputTokenMint: WSOL_ID,
  //         outputTokenMint: token_mint.publicKey,
  //         observationState: observation_state
  //       })
  //       .signers([creator])

  //       .rpc({ skipPreflight: true })
  //       .then(confirm);

  //   } catch (error) {
  //     console.error("\UNIT TEST *Swap* ERROR -", error.message);
  //   }
  // });

  //   // CPI Harvest the locked liquidity
  //   it("Harvest the locked liquidity", async () => {
  //     try {

  //     const harvestLockedCpiIx = await program.methods
  //       .harvestLockedLiquidity(
  //     )
  //       .accountsPartial({
  //         lockCpmmProgram: LOCK_CPMM_PROGRAM_ID,
  //         ammConfig: AMM_CONFIG_ID,
  //         creator: creator.publicKey,
  //         authority: LOCK_CPMM_AUTHORITY_ID,
  //         feeNftAccount: nft_mint_acc,
  //         lockedLiquidity: locked_liquidity,
  //         cpSwapProgram: CPMM_PROGRAM_ID,
  //         cpAuthority: authority,
  //         poolState: pool_state,
  //         lpMint: lp_mint,
  //         baseVault: creator_base_ata,
  //         tokenVault: creator_token_ata,
  //         token0Vault: token_vault_0,
  //         token1Vault: token_vault_1,
  //         baseMint: WSOL_ID,
  //         tokenMint: token_mint.publicKey,
  //         lockedLpVault: locked_lp_vault,
  //         systemProgram: SystemProgram.programId,
  //         memoProgram: MEMO_PROGRAM,
  //         token0Program: TOKEN_PROGRAM_ID,
  //         token1Program: TOKEN_2022_PROGRAM_ID,
  //       })
  //       .signers([creator])

  //       .rpc({ skipPreflight: true })
  //       .then(confirm);

  //   } catch (error) {
  //     console.error("\UNIT TEST *Harvest the locked liquidity* ERROR -", error.message);
  //   }
  // });

  it("execute confidential swap", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    console.log("Initializing compute swap computation definition");
    const initSwapSig = await initComputeSwapCompDef(program, owner, false);
    console.log(
      "Compute swap computation definition initialized with signature",
      initSwapSig
    );

    const privateKey = x25519.utils.randomPrivateKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const DECIMALS = 6;

    const swapAmount = BigInt(10 * Math.pow(10, DECIMALS));
    const minOutput = BigInt(8 * Math.pow(10, DECIMALS));

    const nonce = randomBytes(16);
    const ciphertextAmount = cipher.encrypt([swapAmount], nonce);


    const ciphertextMinOutput = cipher.encrypt([minOutput], nonce);

    const swapExecutedEventPromise = awaitEvent(
      "confidentialSwapExecutedEvent"
    );

    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const swapStatePda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("swap_state"),
        // user.publicKey.toBuffer()
      ],
      program.programId
    )[0];

    const queueSig = await program.methods
      .computeSwap(
        computationOffset,
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString()),
        Array.from(ciphertextAmount[0]),
        Array.from(ciphertextMinOutput[0])
      )
      .accountsPartial({
        user: creator.publicKey,
        swapState: swapStatePda,
        computationAccount: getComputationAccAddress(
          program.programId,
          computationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("compute_swap")).readUInt32LE()
        ),
      })
      .signers([creator])
      .rpc({ commitment: "confirmed" });
    console.log("Queue sig is ", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize sig is ", finalizeSig);

    const swapExecutedEvent = await swapExecutedEventPromise;

    console.log(swapExecutedEvent);

    let output = cipher.decrypt(
      [swapExecutedEvent.execute, swapExecutedEvent.withdrawAmount],
      swapExecutedEvent.nonce.toArrayLike(Buffer, "le", 16)
    );
    console.log(`deposit amount is ${output[0]}`);
    console.log(`withdraw amount is ${output[1]}`);
  });

  async function initComputeSwapCompDef(
    program: Program<WhisprLimit>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("compute_swap");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    console.log("Comp def pda is ", compDefPDA.toBase58());

    const sig = await program.methods
      .initComputeSwapCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
    console.log("Init compute swap computation definition transaction", sig);

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/compute_swap.arcis");

      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "compute_swap",
        program.programId,
        rawCircuit,
        true
      );
    } else {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );

      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

      finalizeTx.sign(owner);

      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
