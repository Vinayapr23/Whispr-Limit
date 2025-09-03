# Whispr - Confidential Limit Orders for DeFi

A privacy-preserving limit order system built on Solana using Arcium's Multi-Party Computation (MPC) network. Execute trades with encrypted limit prices while maintaining complete confidentiality of your trading parameters on Raydium CPMM pools.

## The Problem We Are Solving

Traditional DeFi limit orders expose sensitive trading information - your limit prices, order sizes, and trading strategies are visible to everyone on-chain. This transparency creates opportunities for front-running, sandwich attacks, and competitive disadvantage. Large traders and sophisticated strategies suffer particularly from this lack of privacy, as their moves can be anticipated and exploited by MEV bots and other market participants.

## Why It Matters

- **Privacy**: Keep your limit prices and trading strategies completely confidential until execution
- **MEV Protection**: Prevent front-running and sandwich attacks through encrypted order parameters  
- **Fair Trading**: Level the playing field by hiding order information from predatory traders
- **Strategic Advantage**: Execute complex trading strategies without revealing your market position
- **Trustless Execution**: Orders execute automatically via MPC without requiring trusted intermediaries
- **Professional Trading**: Enable institutional-grade privacy for retail and professional traders

## Vision: Privacy-First Automated Market Making

Whispr reimagines limit order execution in DeFi by leveraging confidential computing on existing AMM infrastructure. Users can set limit orders with encrypted parameters that execute automatically when market conditions are met, all while keeping sensitive trading data private throughout the entire process. The system integrates seamlessly with Raydium's CPMM pools to provide deep liquidity while maintaining complete privacy.

## Core Features

### Confidential Limit Orders
- **Encrypted Limit Prices**: Your limit prices are encrypted client-side using x25519 key exchange and RescueCipher
- **Private Order Matching**: MPC network compares encrypted limits with current market prices without revealing either value
- **Conditional Execution**: Orders execute automatically when encrypted conditions are satisfied
- **Secure Communication**: End-to-end encryption between client and MPC network

### Advanced Pool Integration
- **Raydium CPMM Integration**: Native integration with Raydium's constant product market maker pools
- **Pool Creation**: Deploy new CPMM pools with automatic liquidity provisioning
- **Liquidity Locking**: Lock LP tokens with NFT-based fee collection rights
- **Fee Harvesting**: Collect trading fees from locked liquidity positions
- **Multi-Token Support**: Full support for SPL tokens and Token-2022 standard

### Privacy-Preserving Architecture
- **Client-Side Encryption**: All sensitive data encrypted before leaving your device using industry-standard cryptography
- **MPC Computation**: Secure multi-party computation for private price comparisons and order execution logic
- **Zero-Knowledge Execution**: Orders execute without revealing limit prices or trading intentions
- **On-Chain Auditability**: Transparent execution events with encrypted parameters for compliance

### Devnet

- **Program Id:**: 98Yy1MEB7nKGECxQXoAJGjrBngvsX5hjMkXESrR3stDs
- **MXE Intialise**: 4vXuqgRM7QC8GqcLtoRsDb3kkSc4YM9JqbkgKmj95KKGpCgevArt7D5MCLdK2WSmmpDRFygLxgPvoL2deGGdZnNQ


## Technical Architecture

### Solana Anchor Program (`programs/whispr_limit`)
Core on-chain logic implementing confidential limit order functionality built with Anchor framework:

**Pool Management**:
- Create and initialize Raydium CPMM pools with custom token pairs
- Automated token minting and liquidity provisioning
- Integration with Raydium's vault and LP mint authority system

**Order Processing**:
- Encrypted limit data storage with user-specific PDAs
- MPC computation queuing for confidential price comparisons
- Automatic swap execution based on encrypted computation results

**Liquidity Operations**:
- LP token locking with NFT-based ownership and fee collection
- Automated fee harvesting from locked liquidity positions
- Integration with Raydium's locking program

### Confidential Computing Layer (Arcium MPC)
Encrypted instruction circuits for private computation:

```rust
pub struct SwapAmount {
    limit_amount: u64,    // Encrypted limit price
    amount: u64,         // Encrypted order size
}

pub struct SwapResult {
    pub execute: u64,         // 1 if should execute, 0 if not
    pub withdraw_amount: u64, // Amount to withdraw if executed
}
```

**Computation Flow**:
1. Encrypted limit price and current market data sent to MPC network
2. Private comparison determines if order should execute
3. Encrypted results returned to user with execution decision
4. If conditions met, automatic swap executes on Raydium pool

### Key Technical Components

#### Encryption System
- **x25519 Key Exchange**: Secure key agreement between client and MPC network
- **RescueCipher**: Symmetric encryption for sensitive order parameters
- **Nonce-Based Security**: Unique nonces prevent replay attacks and ensure forward secrecy

#### Event-Driven Architecture
```typescript
interface ConfidentialSwapExecutedEvent {
  user: PublicKey;
  execute: [u8; 32];        // Encrypted execution decision
  withdraw_amount: [u8; 32]; // Encrypted withdrawal amount  
  nonce: u128;              // Decryption nonce
}
```

## Supported Operations

### Core Trading Functions

**Confidential Limit Order Placement**:
- Encrypt limit price and order size client-side
- Store encrypted parameters in user-specific PDA
- Queue MPC computation for price comparison

**Automatic Order Execution**:
- MPC network privately evaluates market conditions
- Orders execute automatically when limits are reached
- Results delivered as encrypted events

**Pool Operations**:
- Create new CPMM pools with automated setup
- Provide initial liquidity and lock LP tokens
- Harvest fees from trading activity

### Advanced Features

**Multi-Token Pool Support**:
- WSOL/Token pools with automatic wrapping
- Custom token pair deployment
- Token-2022 compatibility

**Liquidity Management**:
- Time-locked LP positions with NFT ownership
- Automated fee collection from pool trading
- Social recovery mechanisms for locked assets

## Implementation Example

### Setting Up a Confidential Limit Order

```typescript
import { WhisprLimit } from "@whispr/limit-sdk";
import { RescueCipher, x25519 } from "@arcium-hq/client";

// 1. Generate encryption keys
const privateKey = x25519.utils.randomPrivateKey();
const publicKey = x25519.getPublicKey(privateKey);
const mxePublicKey = await getMXEPublicKey(provider, programId);
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
const cipher = new RescueCipher(sharedSecret);

// 2. Encrypt order parameters
const limitAmount = BigInt(5 * 10**6); // 5 tokens (6 decimals)
const orderSize = BigInt(10 * 10**6);   // 10 tokens
const nonce = randomBytes(16);
const encryptedData = cipher.encrypt([limitAmount, orderSize], nonce);

// 3. Store encrypted limit data
await program.methods
  .limitData(encryptedData[0])
  .accounts({
    payer: userPublicKey,
    data: limitDataPDA,
    systemProgram: SystemProgram.programId,
  })
  .signers([userKeypair])
  .rpc();

// 4. Queue confidential computation
const computationOffset = new BN(randomBytes(8), "hex");
await program.methods
  .computeSwap(
    computationOffset,
    Array.from(publicKey),
    new BN(deserializeLE(nonce).toString()),
    Array.from(encryptedData[1])
  )
  .accounts({
    user: userPublicKey,
    swapState: swapStatePDA,
    data: limitDataPDA,
    // ... MPC network accounts
  })
  .signers([userKeypair])
  .rpc();
```

### Monitoring Order Execution

```typescript
// Listen for execution events
const eventPromise = program.addEventListener(
  'confidentialSwapExecutedEvent', 
  async (event) => {
    // Decrypt execution results
    const results = cipher.decrypt(
      [event.execute, event.withdrawAmount],
      event.nonce.toArrayLike(Buffer, "le", 16)
    );
    
    const shouldExecute = results[0];
    const withdrawAmount = results[1];
    
    if (shouldExecute === BigInt(1)) {
      console.log(`Order executed! Withdrawing ${withdrawAmount} tokens`);
      
      // Execute actual swap on Raydium pool
      await executeSwapOnPool(withdrawAmount);
    }
  }
);
```

### Pool Creation and Management

```typescript
// Create new CPMM pool with locked liquidity
await program.methods
  .createCpmmPool(null) // Use default funding amount
  .accounts({
    cpSwapProgram: RAYDIUM_CPMM_PROGRAM_ID,
    creator: userPublicKey,
    baseMint: WSOL_MINT,
    tokenMint: customTokenMint,
    // ... pool setup accounts
  })
  .signers([userKeypair, tokenMintKeypair])
  .rpc();

// Lock liquidity and mint fee NFT
await program.methods
  .lockCpmmLiquidity()
  .accounts({
    lockCpmmProgram: RAYDIUM_LOCKING_PROGRAM_ID,
    feeNftMint: nftMintKeypair.publicKey,
    // ... locking accounts
  })
  .signers([userKeypair, nftMintKeypair])
  .rpc();
```

## Security Model

### Cryptographic Security
- **End-to-End Encryption**: x25519 ECDH + RescueCipher provide strong encryption
- **Forward Secrecy**: Unique session keys for each computation
- **Authenticated Encryption**: Prevents tampering with encrypted parameters
- **Secure Random**: Cryptographically secure nonce generation

### MPC Network Security
- **Threshold Computation**: Requires majority of nodes for any computation
- **Byzantine Fault Tolerance**: System remains secure with up to 1/3 malicious nodes  
- **Verifiable Results**: Cryptographic proofs ensure computation correctness
- **No Single Point of Trust**: No individual party can access sensitive data

### Smart Contract Security
- **Anchor Framework**: Built with Solana's secure development framework
- **PDA-Based Access Control**: User-specific program derived addresses
- **Comprehensive Validation**: All account relationships validated on-chain
- **Integration Security**: Secure CPI calls to established Raydium protocols

## Project Structure

```
whispr-limit/
├── programs/whispr_limit/        # Main Solana program
│   ├── src/lib.rs               # Core program logic and entry points
│   └── src/contexts/            # Account context definitions
│       ├── create_cpmm_pool.rs  # Raydium pool creation
│       ├── lock_cpmm_lp.rs      # LP token locking
│       ├── harvest_locked_fee.rs # Fee harvesting
│       └── swap.rs              # Swap execution
├── encrypted-ixs/               # MPC computation circuits  
│   └── src/lib.rs              # Confidential swap logic
├── tests/                      # Comprehensive test suite
│   └── whispr_limit.ts         # End-to-end integration tests
└── target/types/               # Generated TypeScript bindings
```

## Integration Points

### Raydium CPMM Protocol
- **Pool Creation**: Direct integration with Raydium's pool factory
- **Liquidity Management**: Native LP token operations and fee collection
- **Swap Execution**: Automatic routing through established pools
- **Oracle Integration**: Price data from Raydium's observation accounts

### Arcium MPC Network
- **Computation Definition**: Pre-deployed MPC circuits for limit order logic
- **Event-Driven Execution**: Automatic triggering based on market conditions
- **Secure Communication**: Encrypted channels between client and network
- **Result Delivery**: Tamper-proof delivery of computation outcomes

## Use Cases

### Professional Traders
- **Large Order Privacy**: Execute substantial positions without market impact visibility
- **Strategy Protection**: Keep sophisticated trading algorithms confidential
- **Automated Execution**: Set complex conditional orders with private parameters
- **Risk Management**: Private stop-losses and take-profit levels

### Market Makers
- **Confidential Spreads**: Maintain competitive pricing without revealing strategy
- **Dynamic Hedging**: Automated rebalancing with private triggers
- **Cross-Pool Arbitrage**: Execute arbitrage opportunities privately
- **Liquidity Mining**: Earn fees while keeping strategy parameters secret

### Retail Traders  
- **Privacy Protection**: Prevent front-running of personal trades
- **Dollar-Cost Averaging**: Automated buying/selling with private schedules
- **Limit Order Privacy**: Set buy/sell orders without revealing intentions
- **Portfolio Rebalancing**: Maintain target allocations privately

### Institutional Users
- **Regulatory Compliance**: Meet privacy requirements while maintaining auditability
- **Multi-Account Coordination**: Coordinate trading across accounts privately
- **Algorithmic Trading**: Deploy automated strategies without revealing logic
- **Treasury Management**: Execute large treasury operations discretely


## License

MIT License - See LICENSE file for complete terms.

