use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // Simple struct with just amount
    pub struct SwapAmount {
        amount: u64,
        min_amount: u64,
    }

    // Return struct with both amounts
    #[derive(Debug, Clone)]
    pub struct SwapResult {
        pub execute: u64,
        pub withdraw_amount: u64,
    }

    #[instruction]
    pub fn compute_swap(swap_amount_ctxt: Enc<Shared, SwapAmount>) -> Enc<Shared, SwapResult> {
        // Return revealed struct
        let swap_amount = swap_amount_ctxt.to_arcis();
        let amount: u64 = swap_amount.amount;
        let min_amount: u64 = swap_amount.min_amount;

        let result = SwapResult {
            execute: 0,
            withdraw_amount: min_amount,
        };

        swap_amount_ctxt.owner.from_arcis(result)
    }
}
