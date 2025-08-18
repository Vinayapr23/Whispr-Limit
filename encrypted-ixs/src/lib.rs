use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // Simple struct with just amount
    pub struct SwapAmount {
        limit_amount: u64,
        amount: u64,
  
    }

    // Return struct with both amounts
    #[derive(Debug, Clone)]
    pub struct SwapResult {
        pub execute: u64,
        pub withdraw_amount: u64,
    }

    #[instruction]
    pub fn compute_swap(swap_amount_ctxt: Enc<Shared, SwapAmount>) -> Enc<Shared, SwapResult> {
       
        let swap_amount = swap_amount_ctxt.to_arcis();
       
        let limit_amount: u64 = swap_amount.limit_amount;
         let amount: u64 = swap_amount.amount;
        
         let mut result = SwapResult {
            execute: 1,
            withdraw_amount: amount,
         };

        if(amount>=limit_amount)
        {
            result = SwapResult {
            execute: 0,
            withdraw_amount: amount,
        };
        }
     

        swap_amount_ctxt.owner.from_arcis(result)
    }
}
