use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod contexts;
pub use contexts::*;
mod constants;

const COMP_DEF_OFFSET_COMPUTE_SWAP: u32 = comp_def_offset("compute_swap");

declare_id!("98Yy1MEB7nKGECxQXoAJGjrBngvsX5hjMkXESrR3stDs");

#[arcium_program]
pub mod whispr_limit {
    use arcium_client::idl::arcium::types::CallbackAccount;

    use crate::instruction::LimitData;

    use super::*;

    pub fn limit_data(ctx: Context<StoreLimitData>, limit: [u8; 32]) -> Result<()> {
        let data = &mut ctx.accounts.data;
        data.limit = limit;
        Ok(())
    }

    pub fn create_cpmm_pool(
        ctx: Context<CreateCpmmPool>,
        funding_amount: Option<u64>,
    ) -> Result<()> {
        ctx.accounts.issue_tokens()?;
        ctx.accounts.revoke_mint_authority()?;
        ctx.accounts.create_cpmm_pool(funding_amount)
    }
    pub fn lock_cpmm_liquidity(ctx: Context<LockCpmmLiquidity>) -> Result<()> {
        ctx.accounts.lock_cpmm_cpi()
    }
    pub fn harvest_locked_liquidity(ctx: Context<HarvestLockedLiquidity>) -> Result<()> {
        ctx.accounts.harvest_cp_fees_cpi()
    }
    pub fn swap(ctx: Context<Swap>, amount_in: u64, minimum_amount_out: u64) -> Result<()> {
        ctx.accounts.swap(amount_in, minimum_amount_out)
    }

    pub fn init_compute_swap_comp_def(ctx: Context<InitComputeSwapCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn compute_swap(
        ctx: Context<ComputeSwap>,
        computation_offset: u64,
        pub_key: [u8; 32],
        nonce: u128,
        encrypted_amount: [u8; 32], // Encrypted u64
    ) -> Result<()> {
        // Initialize swap state
        let clock = Clock::get()?;
        ctx.accounts.swap_state.user = ctx.accounts.user.key();
        ctx.accounts.swap_state.computation_offset = computation_offset;
        ctx.accounts.swap_state.amount = 0;
        ctx.accounts.swap_state.min_output = 0;
        ctx.accounts.swap_state.status = SwapStatus::Initiated;
        ctx.accounts.swap_state.created_at = clock.unix_timestamp;

        // msg!(stringify!(encrypted_amount==ctx.accounts.data.limit));
        // Pass three encrypted values separately
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(ctx.accounts.data.limit), //
            Argument::EncryptedU64(encrypted_amount),        // amount
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: ctx.accounts.user.key(),
                is_writable: true,
            }],
            None,
        )?;
        ctx.accounts.swap_state.status = SwapStatus::Computing;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "compute_swap")]
    pub fn compute_swap_callback(
        ctx: Context<ComputeSwapCallback>,
        output: ComputationOutputs<ComputeSwapOutput>,
    ) -> Result<()> {
        // Extract results from MPC computation
        let swap_result = match output {
            ComputationOutputs::Success(ComputeSwapOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Decrypt the results
        // The circuit returns SwapResult
        let execute = swap_result.ciphertexts[0];
        // u64::from_le_bytes(swap_result.ciphertexts[0][..8].try_into().unwrap());

        let withdraw_amount = swap_result.ciphertexts[1];
        //u64::from_le_bytes(swap_result.ciphertexts[1][..8].try_into().unwrap());

        emit!(ConfidentialSwapExecutedEvent {
            user: ctx.accounts.user.key(),
            execute,
            withdraw_amount,
            nonce: swap_result.nonce,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct StoreLimitData<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init,
        payer = payer,
        space = 8 + LimitData::INIT_SPACE,
        seeds = [b"limit_data", payer.key().as_ref()],
        bump,
    )]
    pub data: Account<'info, LimitData>,
}

#[queue_computation_accounts("compute_swap", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ComputeSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_SWAP)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = SwapState::INIT_SPACE,
        seeds = [b"swap_state", user.key().as_ref()],
        bump
    )]
    pub swap_state: Box<Account<'info, SwapState>>,

    pub data: Account<'info, LimitData>,
}

#[callback_accounts("compute_swap", payer)]
#[derive(Accounts)]
pub struct ComputeSwapCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_SWAP)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    ///CHECK:doc
    #[account(mut)]
    pub user: AccountInfo<'info>,
}

#[init_computation_definition_accounts("compute_swap", payer)]
#[derive(Accounts)]
pub struct InitComputeSwapCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct LimitData {
    pub limit: [u8; 32],
}

#[account]
pub struct SwapState {
    pub user: Pubkey,
    pub computation_offset: u64,
    pub amount: u64,
    pub min_output: u64,
    pub status: SwapStatus,
    pub created_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SwapStatus {
    Initiated,
    Computing,
    Computed,
    Executed,
    Failed,
}

impl Space for SwapState {
    const INIT_SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 8;
}

#[event]
pub struct ConfidentialSwapInitiatedEvent {
    pub user: Pubkey,
    pub config: Pubkey,
    pub computation_offset: u64,
}

#[event]
pub struct ConfidentialSwapExecutedEvent {
    pub user: Pubkey,
    pub execute: [u8; 32],
    pub withdraw_amount: [u8; 32],
    pub nonce: u128,
    // pub is_x: bool,
}

#[event]
pub struct ConfidentialSwapFailedEvent {
    pub user: Pubkey,
    pub config: Pubkey,
    pub computation_offset: u64,
    pub reason: String,
}

// ========================= ERRORS =========================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("This pool is locked")]
    PoolLocked,
    #[msg("Slippage exceeded")]
    SlippageExceded,
    #[msg("Invalid Amount")]
    InvalidAmount,
    #[msg("Invalid update authority")]
    InvalidAuthority,
}
