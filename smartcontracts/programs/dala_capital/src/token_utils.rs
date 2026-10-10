use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenInterface, TransferChecked};

pub fn transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from,
                mint: mint.to_account_info(),
                to,
                authority,
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}

pub fn close<'info>(
    token_program: &Interface<'info, TokenInterface>,
    account: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account,
            destination,
            authority,
        },
        signer_seeds,
    ))
}
