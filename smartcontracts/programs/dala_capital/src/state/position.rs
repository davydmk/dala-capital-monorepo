use anchor_lang::prelude::*;

use crate::math::pending;

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub deal: Pubkey,
    pub user_id: [u8; 16],
    /// Сумма взносов пользователя в кампанию. После закрытия сбора не меняется.
    pub principal: u64,
    pub checkpoint_principal: u128,
    pub checkpoint_interest: u128,
    pub checkpoint_penalty: u128,
    pub checkpoint_prepayment_fee: u128,
    pub bump: u8,
}

#[derive(Clone, Copy, Default)]
pub struct Payout {
    pub principal: u64,
    pub interest: u64,
    pub penalty: u64,
    pub prepayment_fee: u64,
}

impl Payout {
    pub fn total(&self) -> Result<u64> {
        let sum = (self.principal as u128)
            + (self.interest as u128)
            + (self.penalty as u128)
            + (self.prepayment_fee as u128);
        crate::math::to_u64(sum)
    }
}

impl Position {
    pub fn pending_payout(
        &self,
        acc_principal: u128,
        acc_interest: u128,
        acc_penalty: u128,
        acc_prepayment_fee: u128,
    ) -> Result<Payout> {
        Ok(Payout {
            principal: pending(self.principal, acc_principal, self.checkpoint_principal)?,
            interest: pending(self.principal, acc_interest, self.checkpoint_interest)?,
            penalty: pending(self.principal, acc_penalty, self.checkpoint_penalty)?,
            prepayment_fee: pending(
                self.principal,
                acc_prepayment_fee,
                self.checkpoint_prepayment_fee,
            )?,
        })
    }
}
