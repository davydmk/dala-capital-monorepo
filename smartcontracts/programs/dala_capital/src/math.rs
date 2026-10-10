use anchor_lang::prelude::*;

use crate::constants::SCALE;
use crate::errors::DalaError;

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(DalaError::MathOverflow))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(DalaError::MathOverflow))
}

pub fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(DalaError::MathOverflow))
}

/// `floor(a × b / c)`.
pub fn mul_div(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, DalaError::MathOverflow);
    a.checked_mul(b)
        .map(|x| x / c)
        .ok_or_else(|| error!(DalaError::MathOverflow))
}

/// Сдвигает аккумулятор статьи на `amount`, распределённый на `total_raised`.
/// Деление вниз, остаток переносится в следующее распределение.
pub fn distribute(acc: &mut u128, carry: &mut u128, amount: u64, total_raised: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    require!(total_raised > 0, DalaError::MathOverflow);
    let numerator = (amount as u128)
        .checked_mul(SCALE)
        .and_then(|x| x.checked_add(*carry))
        .ok_or_else(|| error!(DalaError::MathOverflow))?;
    let denominator = total_raised as u128;
    *acc = acc
        .checked_add(numerator / denominator)
        .ok_or_else(|| error!(DalaError::MathOverflow))?;
    *carry = numerator % denominator;
    Ok(())
}

/// Доступно позиции по статье: `floor(principal × (acc − checkpoint) / SCALE)`.
pub fn pending(principal: u64, acc: u128, checkpoint: u128) -> Result<u64> {
    let delta = acc
        .checked_sub(checkpoint)
        .ok_or_else(|| error!(DalaError::MathOverflow))?;
    to_u64(mul_div(principal as u128, delta, SCALE)?)
}
