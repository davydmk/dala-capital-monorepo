/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/dala_capital.json`.
 */
export type DalaCapital = {
  address: 'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB';
  metadata: {
    name: 'dalaCapital';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Created with Anchor';
  };
  instructions: [
    {
      name: 'addSchedulePeriods';
      discriminator: [135, 113, 126, 122, 147, 205, 126, 26];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'periods';
          type: {
            vec: {
              defined: {
                name: 'periodInput';
              };
            };
          };
        },
      ];
    },
    {
      name: 'allowMint';
      discriminator: [240, 28, 240, 70, 124, 240, 245, 225];
      accounts: [
        {
          name: 'admin';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'mint';
        },
        {
          name: 'treasury';
        },
        {
          name: 'treasuryToken';
          docs: [
            'Создаётся вместе с разрешением токена: закрытие сбора может вызвать кто угодно,',
            'и оплачивать создание счёта казны ему не придётся.',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'treasury';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [];
    },
    {
      name: 'cancelCampaign';
      discriminator: [66, 10, 32, 138, 122, 36, 134, 202];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'closeFunding';
      discriminator: [151, 114, 204, 37, 205, 230, 237, 154];
      accounts: [
        {
          name: 'operator';
          docs: [
            'Только оператор: перевод заёмщику проходит после того, как бэкенд подтвердил адрес.',
            'Платит за создание ATA заёмщика, если её нет.',
          ];
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'borrowerWallet';
          relations: ['deal'];
        },
        {
          name: 'payoutDestination';
          docs: [
            'ATA заёмщика. Создаётся, если её нет: например, биржа закрыла пустой депозитный счёт.',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'borrowerWallet';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'treasuryToken';
          writable: true;
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'createCampaign';
      discriminator: [111, 131, 187, 98, 160, 193, 114, 244];
      accounts: [
        {
          name: 'admin';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'mint';
        },
        {
          name: 'borrowerWallet';
          docs: [
            'Не должен быть токен-счётом: ATA токен-счёта — потерянные деньги.',
          ];
        },
        {
          name: 'repayOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [114, 101, 112, 97, 121];
              },
              {
                kind: 'account';
                path: 'deal';
              },
            ];
          };
        },
        {
          name: 'vault';
          docs: [
            '`init_if_needed`: адрес ATA вычисляется из номера кампании, и посторонний может создать его',
            'заранее, чтобы заблокировать создание кампании. Хозяин всё равно PDA кампании — это',
            'проверяют ограничения ниже; учёт опирается на разницу балансов, лишние токены — пыль.',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'repayToken';
          docs: [
            '`init_if_needed` — по той же причине. Токены, присланные заранее, засчитываются как погашение.',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'repayOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'params';
          type: {
            defined: {
              name: 'campaignParams';
            };
          };
        },
      ];
    },
    {
      name: 'createUser';
      discriminator: [108, 227, 130, 130, 252, 109, 75, 218];
      accounts: [
        {
          name: 'whitelistAuthority';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'user';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
        {
          name: 'entityType';
          type: {
            defined: {
              name: 'entityType';
            };
          };
        },
        {
          name: 'withdrawalAddress';
          type: 'pubkey';
        },
        {
          name: 'whitelistStatus';
          type: 'bool';
        },
      ];
    },
    {
      name: 'finalizeSchedule';
      discriminator: [97, 144, 109, 15, 122, 48, 113, 254];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'initPlatform';
      discriminator: [29, 22, 210, 225, 219, 114, 193, 169];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'platform';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'admin';
          type: 'pubkey';
        },
        {
          name: 'operator';
          type: 'pubkey';
        },
        {
          name: 'whitelistAuthority';
          type: 'pubkey';
        },
        {
          name: 'treasury';
          type: 'pubkey';
        },
      ];
    },
    {
      name: 'invest';
      discriminator: [13, 245, 180, 103, 254, 182, 121, 4];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'user';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'position';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 111, 115];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'depositOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 112, 111, 115, 105, 116];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'depositToken';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'depositOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
      ];
    },
    {
      name: 'markDefault';
      discriminator: [182, 231, 123, 132, 66, 208, 137, 139];
      accounts: [
        {
          name: 'caller';
          signer: true;
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'openDeposit';
      discriminator: [39, 198, 241, 57, 118, 36, 167, 56];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'user';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'depositOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 112, 111, 115, 105, 116];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'mint';
        },
        {
          name: 'depositToken';
          docs: [
            '`init_if_needed`: ATA для любого владельца может создать кто угодно,',
            'и это не должно блокировать открытие адреса.',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'depositOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
      ];
    },
    {
      name: 'prepayFull';
      discriminator: [0, 43, 56, 221, 186, 218, 93, 45];
      accounts: [
        {
          name: 'operator';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'repayOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [114, 101, 112, 97, 121];
              },
              {
                kind: 'account';
                path: 'deal';
              },
            ];
          };
        },
        {
          name: 'repayToken';
          writable: true;
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'prepayPartial';
      discriminator: [51, 185, 205, 68, 0, 123, 10, 176];
      accounts: [
        {
          name: 'operator';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'repayOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [114, 101, 112, 97, 121];
              },
              {
                kind: 'account';
                path: 'deal';
              },
            ];
          };
        },
        {
          name: 'repayToken';
          writable: true;
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'principalAmount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'processRepayment';
      discriminator: [88, 207, 169, 139, 144, 218, 37, 218];
      accounts: [
        {
          name: 'caller';
          signer: true;
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'repayOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [114, 101, 112, 97, 121];
              },
              {
                kind: 'account';
                path: 'deal';
              },
            ];
          };
        },
        {
          name: 'repayToken';
          writable: true;
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'treasuryToken';
          writable: true;
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'recordRecoveryCost';
      discriminator: [229, 247, 23, 16, 153, 67, 245, 217];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'amount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'removeMint';
      discriminator: [113, 35, 250, 141, 254, 115, 233, 5];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'mint';
          type: 'pubkey';
        },
      ];
    },
    {
      name: 'setBorrowerWallet';
      discriminator: [236, 104, 204, 193, 15, 43, 160, 84];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'borrowerWallet';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
      ];
    },
    {
      name: 'setWhitelistStatus';
      discriminator: [50, 211, 63, 180, 79, 84, 24, 129];
      accounts: [
        {
          name: 'whitelistAuthority';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'user';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
        {
          name: 'whitelistStatus';
          type: 'bool';
        },
      ];
    },
    {
      name: 'setWithdrawalAddress';
      discriminator: [135, 42, 36, 179, 239, 67, 106, 190];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'user';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
        {
          name: 'withdrawalAddress';
          type: 'pubkey';
        },
      ];
    },
    {
      name: 'updatePlatform';
      discriminator: [46, 78, 138, 189, 47, 163, 120, 85];
      accounts: [
        {
          name: 'admin';
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'newAdmin';
          type: {
            option: 'pubkey';
          };
        },
        {
          name: 'newOperator';
          type: {
            option: 'pubkey';
          };
        },
        {
          name: 'newWhitelistAuthority';
          type: {
            option: 'pubkey';
          };
        },
        {
          name: 'newTreasury';
          type: {
            option: 'pubkey';
          };
        },
      ];
    },
    {
      name: 'withdrawDeposit';
      discriminator: [197, 59, 182, 208, 73, 187, 119, 25];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'user';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'depositOwner';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 112, 111, 115, 105, 116];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'depositToken';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'depositOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'withdrawalOwner';
        },
        {
          name: 'destination';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'withdrawalOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
      ];
    },
    {
      name: 'withdrawPayout';
      discriminator: [114, 146, 48, 240, 49, 57, 108, 188];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'user';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'position';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 111, 115];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'withdrawalOwner';
        },
        {
          name: 'destination';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'withdrawalOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
      ];
    },
    {
      name: 'withdrawRefund';
      discriminator: [220, 99, 224, 50, 13, 71, 215, 101];
      accounts: [
        {
          name: 'operator';
          writable: true;
          signer: true;
          relations: ['platform'];
        },
        {
          name: 'platform';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 108, 97, 116, 102, 111, 114, 109];
              },
            ];
          };
          relations: ['deal'];
        },
        {
          name: 'deal';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [100, 101, 97, 108];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'campaignId';
              },
            ];
          };
        },
        {
          name: 'user';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [117, 115, 101, 114];
              },
              {
                kind: 'account';
                path: 'platform';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'position';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [112, 111, 115];
              },
              {
                kind: 'account';
                path: 'deal';
              },
              {
                kind: 'arg';
                path: 'userId';
              },
            ];
          };
        },
        {
          name: 'withdrawalOwner';
        },
        {
          name: 'destination';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'withdrawalOwner';
              },
              {
                kind: 'account';
                path: 'tokenProgram';
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'vault';
          writable: true;
          relations: ['deal'];
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'eventAuthority';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: 'program';
        },
      ];
      args: [
        {
          name: 'campaignId';
          type: 'u64';
        },
        {
          name: 'userId';
          type: {
            array: ['u8', 16];
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: 'deal';
      discriminator: [125, 223, 160, 234, 71, 162, 182, 219];
    },
    {
      name: 'platform';
      discriminator: [77, 92, 204, 58, 187, 98, 91, 12];
    },
    {
      name: 'position';
      discriminator: [170, 188, 143, 228, 122, 64, 247, 208];
    },
    {
      name: 'userAccount';
      discriminator: [211, 33, 136, 16, 186, 110, 242, 127];
    },
  ];
  events: [
    {
      name: 'borrowerWalletChanged';
      discriminator: [22, 162, 182, 97, 208, 181, 183, 29];
    },
    {
      name: 'campaignCancelled';
      discriminator: [121, 171, 21, 55, 56, 234, 121, 44];
    },
    {
      name: 'campaignCreated';
      discriminator: [9, 98, 69, 61, 53, 131, 64, 152];
    },
    {
      name: 'defaultMarked';
      discriminator: [16, 102, 206, 133, 227, 138, 211, 138];
    },
    {
      name: 'depositOpened';
      discriminator: [209, 91, 71, 104, 176, 175, 216, 162];
    },
    {
      name: 'depositWithdrawn';
      discriminator: [152, 139, 194, 204, 237, 235, 26, 134];
    },
    {
      name: 'earlyRepayment';
      discriminator: [152, 126, 10, 20, 41, 59, 116, 184];
    },
    {
      name: 'fundingClosed';
      discriminator: [190, 26, 110, 166, 120, 148, 163, 71];
    },
    {
      name: 'fundingFailed';
      discriminator: [157, 28, 229, 25, 248, 253, 183, 60];
    },
    {
      name: 'invested';
      discriminator: [178, 41, 156, 68, 189, 44, 235, 152];
    },
    {
      name: 'mintAllowed';
      discriminator: [80, 212, 130, 120, 125, 216, 111, 240];
    },
    {
      name: 'mintRemoved';
      discriminator: [118, 55, 212, 63, 31, 45, 74, 66];
    },
    {
      name: 'payoutWithdrawn';
      discriminator: [97, 61, 38, 210, 215, 27, 247, 115];
    },
    {
      name: 'platformInitialized';
      discriminator: [16, 222, 212, 5, 213, 140, 112, 162];
    },
    {
      name: 'platformUpdated';
      discriminator: [75, 10, 83, 45, 92, 4, 133, 128];
    },
    {
      name: 'recoveryCostRecorded';
      discriminator: [117, 176, 210, 9, 9, 0, 19, 40];
    },
    {
      name: 'refundWithdrawn';
      discriminator: [51, 49, 35, 233, 115, 199, 172, 251];
    },
    {
      name: 'repaymentProcessed';
      discriminator: [4, 68, 8, 11, 109, 185, 23, 224];
    },
    {
      name: 'scheduleFinalized';
      discriminator: [120, 34, 195, 158, 224, 85, 45, 162];
    },
    {
      name: 'schedulePeriodsAdded';
      discriminator: [8, 254, 143, 31, 48, 185, 157, 66];
    },
    {
      name: 'userCreated';
      discriminator: [145, 177, 42, 214, 0, 65, 40, 69];
    },
    {
      name: 'whitelistChanged';
      discriminator: [18, 182, 247, 32, 217, 100, 79, 122];
    },
    {
      name: 'withdrawalAddressChanged';
      discriminator: [22, 245, 220, 144, 254, 55, 129, 152];
    },
  ];
  errors: [
    {
      code: 6000;
      name: 'invalidPubkey';
      msg: 'Нулевой публичный ключ недопустим';
    },
    {
      code: 6001;
      name: 'unauthorized';
      msg: 'Подписант не имеет прав на эту операцию';
    },
    {
      code: 6002;
      name: 'mintNotAllowed';
      msg: 'Токен не разрешён платформой';
    },
    {
      code: 6003;
      name: 'tooManyMints';
      msg: 'Достигнут лимит разрешённых токенов';
    },
    {
      code: 6004;
      name: 'wrongMint';
      msg: 'Неверный токен';
    },
    {
      code: 6005;
      name: 'invalidCampaignParams';
      msg: 'Неверный параметр кампании';
    },
    {
      code: 6006;
      name: 'invalidSchedule';
      msg: 'Неверный график платежей';
    },
    {
      code: 6007;
      name: 'scheduleFinalized';
      msg: 'График уже зафиксирован';
    },
    {
      code: 6008;
      name: 'scheduleNotFinalized';
      msg: 'График ещё не зафиксирован';
    },
    {
      code: 6009;
      name: 'tooManyPeriods';
      msg: 'Превышено максимальное число платежей';
    },
    {
      code: 6010;
      name: 'invalidDealState';
      msg: 'Операция недопустима в текущем состоянии кампании';
    },
    {
      code: 6011;
      name: 'fundingNotStarted';
      msg: 'Сбор ещё не начался';
    },
    {
      code: 6012;
      name: 'fundingClosed';
      msg: 'Сбор уже закрыт';
    },
    {
      code: 6013;
      name: 'fundingStillOpen';
      msg: 'Сбор ещё не завершён';
    },
    {
      code: 6014;
      name: 'belowMinTicket';
      msg: 'Сумма на адресе пополнения меньше минимального взноса';
    },
    {
      code: 6015;
      name: 'noCapacity';
      msg: 'Нет места для зачисления: достигнут hard cap или max ticket';
    },
    {
      code: 6016;
      name: 'nothingReceived';
      msg: 'Средства не поступили';
    },
    {
      code: 6017;
      name: 'insufficientReceived';
      msg: 'Поступила не вся ожидаемая сумма';
    },
    {
      code: 6018;
      name: 'nothingToWithdraw';
      msg: 'Нечего выводить';
    },
    {
      code: 6019;
      name: 'nothingToProcess';
      msg: 'Нечего обрабатывать';
    },
    {
      code: 6020;
      name: 'insufficientRepayBalance';
      msg: 'Недостаточно средств на адресе погашения';
    },
    {
      code: 6021;
      name: 'whitelistDisabled';
      msg: 'Вывод на адрес заблокирован';
    },
    {
      code: 6022;
      name: 'addressChangeDelayNotPassed';
      msg: 'С момента смены адреса вывода не прошло 48 часов';
    },
    {
      code: 6023;
      name: 'defaultThresholdNotReached';
      msg: 'Порог дефолта не достигнут';
    },
    {
      code: 6024;
      name: 'prepaymentNotAllowed';
      msg: 'Досрочное погашение недоступно для этой схемы';
    },
    {
      code: 6025;
      name: 'notPaymentDate';
      msg: 'Частичное досрочное погашение возможно только в дату платежа';
    },
    {
      code: 6026;
      name: 'hasOverdue';
      msg: 'Есть просрочка или пеня';
    },
    {
      code: 6027;
      name: 'hasAdvance';
      msg: 'Есть аванс по будущим платежам';
    },
    {
      code: 6028;
      name: 'invalidPrepaymentAmount';
      msg: 'Неверная сумма досрочного погашения';
    },
    {
      code: 6029;
      name: 'invalidAmount';
      msg: 'Неверная сумма';
    },
    {
      code: 6030;
      name: 'mathOverflow';
      msg: 'Переполнение при вычислении';
    },
    {
      code: 6031;
      name: 'invalidBorrowerWallet';
      msg: 'Кошелёк заёмщика не может быть токен-счётом или нулевым ключом';
    },
    {
      code: 6032;
      name: 'cancelGracePeriodActive';
      msg: 'После дедлайна отмена доступна только по истечении льготного срока';
    },
  ];
  types: [
    {
      name: 'borrowerWalletChanged';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'oldWallet';
            type: 'pubkey';
          },
          {
            name: 'newWallet';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'campaignCancelled';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'totalRaised';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'campaignCreated';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'mint';
            type: 'pubkey';
          },
          {
            name: 'borrowerWallet';
            type: 'pubkey';
          },
          {
            name: 'softCap';
            type: 'u64';
          },
          {
            name: 'hardCap';
            type: 'u64';
          },
          {
            name: 'fundingStart';
            type: 'i64';
          },
          {
            name: 'fundingDeadline';
            type: 'i64';
          },
          {
            name: 'scheduleType';
            type: {
              defined: {
                name: 'scheduleType';
              };
            };
          },
          {
            name: 'annualRateBps';
            type: 'u32';
          },
        ];
      };
    },
    {
      name: 'campaignParams';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'softCap';
            type: 'u64';
          },
          {
            name: 'hardCap';
            type: 'u64';
          },
          {
            name: 'minTicket';
            type: 'u64';
          },
          {
            name: 'maxTicket';
            docs: ['0 = без ограничения.'];
            type: 'u64';
          },
          {
            name: 'fundingStart';
            type: 'i64';
          },
          {
            name: 'fundingDeadline';
            docs: ['Дедлайн сбора и начало первого процентного периода.'];
            type: 'i64';
          },
          {
            name: 'scheduleType';
            type: {
              defined: {
                name: 'scheduleType';
              };
            };
          },
          {
            name: 'annualRateBps';
            type: 'u32';
          },
          {
            name: 'periodsPerYear';
            docs: ['12, 4, 2 или 1.'];
            type: 'u8';
          },
          {
            name: 'penaltyRateBps';
            type: 'u32';
          },
          {
            name: 'defaultThresholdDays';
            docs: [
              'Клиент по умолчанию подставляет 90 для аннуитета и 30 для купона.',
            ];
            type: 'u16';
          },
          {
            name: 'prepaymentFeeBps';
            docs: ['Только для аннуитета, для купона должна быть 0.'];
            type: 'u32';
          },
          {
            name: 'platformFeeBps';
            type: 'u32';
          },
          {
            name: 'cancelGraceDays';
            docs: [
              'Через сколько дней после дедлайна админ может отменить кампанию, если сбор не закрыт.',
              'Клиент по умолчанию подставляет 7.',
            ];
            type: 'u16';
          },
        ];
      };
    },
    {
      name: 'deal';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'platform';
            type: 'pubkey';
          },
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'mint';
            type: 'pubkey';
          },
          {
            name: 'vault';
            type: 'pubkey';
          },
          {
            name: 'repayAccount';
            type: 'pubkey';
          },
          {
            name: 'borrowerWallet';
            docs: [
              'Кошелёк заёмщика — владелец, не токен-счёт. Собранные деньги уходят на его ATA,',
              'которая при необходимости создаётся при закрытии сбора.',
            ];
            type: 'pubkey';
          },
          {
            name: 'softCap';
            type: 'u64';
          },
          {
            name: 'hardCap';
            type: 'u64';
          },
          {
            name: 'minTicket';
            type: 'u64';
          },
          {
            name: 'maxTicket';
            docs: ['0 = без ограничения.'];
            type: 'u64';
          },
          {
            name: 'fundingStart';
            type: 'i64';
          },
          {
            name: 'fundingDeadline';
            docs: ['Начало первого процентного периода.'];
            type: 'i64';
          },
          {
            name: 'scheduleType';
            type: {
              defined: {
                name: 'scheduleType';
              };
            };
          },
          {
            name: 'annualRateBps';
            type: 'u32';
          },
          {
            name: 'periodsPerYear';
            type: 'u8';
          },
          {
            name: 'penaltyRateBps';
            type: 'u32';
          },
          {
            name: 'defaultThresholdDays';
            type: 'u16';
          },
          {
            name: 'prepaymentFeeBps';
            type: 'u32';
          },
          {
            name: 'platformFeeBps';
            type: 'u32';
          },
          {
            name: 'cancelGraceDays';
            docs: [
              'Через сколько дней после дедлайна админ может отменить кампанию,',
              'если сбор так и не удалось закрыть.',
            ];
            type: 'u16';
          },
          {
            name: 'periods';
            docs: ['Размер должен совпадать с `MAX_PERIODS`.'];
            type: {
              vec: {
                defined: {
                  name: 'period';
                };
              };
            };
          },
          {
            name: 'scheduleFinalized';
            type: 'bool';
          },
          {
            name: 'state';
            type: {
              defined: {
                name: 'dealState';
              };
            };
          },
          {
            name: 'totalRaised';
            type: 'u64';
          },
          {
            name: 'nextPeriod';
            docs: ['Первый период, дата которого ещё не наступила.'];
            type: 'u8';
          },
          {
            name: 'overduePrincipal';
            docs: ['Неоплаченное тело наступивших периодов (до дефолта).'];
            type: 'u64';
          },
          {
            name: 'overdueScheduledInterest';
            docs: ['Неоплаченные проценты наступивших периодов (до дефолта).'];
            type: 'u64';
          },
          {
            name: 'extraInterest';
            docs: [
              'Проценты по ставке займа, начисленные на просроченное тело (до дефолта).',
            ];
            type: 'u64';
          },
          {
            name: 'penalty';
            type: 'u64';
          },
          {
            name: 'defaultPrincipal';
            docs: ['Весь неоплаченный остаток тела после дефолта.'];
            type: 'u64';
          },
          {
            name: 'defaultInterest';
            docs: ['Неоплаченные проценты после дефолта, включая начисляемые.'];
            type: 'u64';
          },
          {
            name: 'interestCarry';
            type: 'u128';
          },
          {
            name: 'penaltyCarry';
            type: 'u128';
          },
          {
            name: 'lastAccrualTs';
            type: 'i64';
          },
          {
            name: 'recoveryCosts';
            type: 'u64';
          },
          {
            name: 'recoveryReimbursed';
            type: 'u64';
          },
          {
            name: 'accPrincipal';
            type: 'u128';
          },
          {
            name: 'accInterest';
            type: 'u128';
          },
          {
            name: 'accPenalty';
            type: 'u128';
          },
          {
            name: 'accPrepaymentFee';
            type: 'u128';
          },
          {
            name: 'carryPrincipal';
            type: 'u128';
          },
          {
            name: 'carryInterest';
            type: 'u128';
          },
          {
            name: 'carryPenalty';
            type: 'u128';
          },
          {
            name: 'carryPrepaymentFee';
            type: 'u128';
          },
          {
            name: 'bump';
            type: 'u8';
          },
          {
            name: 'repayBump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'dealState';
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'funding';
          },
          {
            name: 'failed';
          },
          {
            name: 'active';
          },
          {
            name: 'default';
          },
          {
            name: 'repaid';
          },
        ];
      };
    },
    {
      name: 'defaultMarked';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'daysPastDue';
            type: 'i64';
          },
          {
            name: 'principal';
            type: 'u64';
          },
          {
            name: 'interest';
            type: 'u64';
          },
          {
            name: 'penalty';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'depositOpened';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'depositToken';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'depositWithdrawn';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'closed';
            type: 'bool';
          },
        ];
      };
    },
    {
      name: 'earlyRepayment';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'full';
            type: 'bool';
          },
          {
            name: 'principal';
            type: 'u64';
          },
          {
            name: 'interest';
            type: 'u64';
          },
          {
            name: 'penalty';
            type: 'u64';
          },
          {
            name: 'prepaymentFee';
            type: 'u64';
          },
          {
            name: 'total';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'entityType';
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'individual';
          },
          {
            name: 'legal';
          },
        ];
      };
    },
    {
      name: 'fundingClosed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'totalRaised';
            type: 'u64';
          },
          {
            name: 'platformFee';
            type: 'u64';
          },
          {
            name: 'payoutAmount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'fundingFailed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'totalRaised';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'invested';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'positionPrincipal';
            type: 'u64';
          },
          {
            name: 'totalRaised';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'mintAllowed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'mint';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'mintRemoved';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'mint';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'payoutWithdrawn';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'principal';
            type: 'u64';
          },
          {
            name: 'interest';
            type: 'u64';
          },
          {
            name: 'penalty';
            type: 'u64';
          },
          {
            name: 'prepaymentFee';
            type: 'u64';
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'period';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'dueTs';
            type: 'i64';
          },
          {
            name: 'principalFraction';
            docs: [
              'Доля тела в платеже, масштаб `SCALE`. Задаётся при создании кампании.',
            ];
            type: 'u64';
          },
          {
            name: 'principalAmount';
            docs: [
              'Тело платежа в токенах. Рассчитывается при закрытии сбора.',
            ];
            type: 'u64';
          },
          {
            name: 'interestAmount';
            docs: [
              'Проценты платежа по графику. Рассчитываются при закрытии сбора',
              'и пересчитываются при частичном досрочном погашении.',
            ];
            type: 'u64';
          },
          {
            name: 'principalPaid';
            type: 'u64';
          },
          {
            name: 'interestPaid';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'periodInput';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'dueTs';
            type: 'i64';
          },
          {
            name: 'principalFraction';
            docs: ['Доля тела в платеже, масштаб `SCALE`.'];
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'platform';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'admin';
            docs: [
              'Мультисиг: роли, токены, кампании, смена адресов вывода, расходы на взыскание.',
            ];
            type: 'pubkey';
          },
          {
            name: 'operator';
            docs: [
              'Горячий ключ: зачисления, выводы, досрочные погашения, обработка платежей в дефолте.',
            ];
            type: 'pubkey';
          },
          {
            name: 'whitelistAuthority';
            docs: ['Создание пользователей и переключение whitelist.'];
            type: 'pubkey';
          },
          {
            name: 'treasury';
            docs: ['Владелец токен-счетов казны.'];
            type: 'pubkey';
          },
          {
            name: 'allowedMints';
            docs: [
              'Разрешённые токены. Размер должен совпадать с `MAX_ALLOWED_MINTS`.',
            ];
            type: {
              vec: 'pubkey';
            };
          },
          {
            name: 'campaignCount';
            type: 'u64';
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'platformInitialized';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'admin';
            type: 'pubkey';
          },
          {
            name: 'operator';
            type: 'pubkey';
          },
          {
            name: 'whitelistAuthority';
            type: 'pubkey';
          },
          {
            name: 'treasury';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'platformUpdated';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'admin';
            type: 'pubkey';
          },
          {
            name: 'operator';
            type: 'pubkey';
          },
          {
            name: 'whitelistAuthority';
            type: 'pubkey';
          },
          {
            name: 'treasury';
            type: 'pubkey';
          },
        ];
      };
    },
    {
      name: 'position';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'deal';
            type: 'pubkey';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'principal';
            docs: [
              'Сумма взносов пользователя в кампанию. После закрытия сбора не меняется.',
            ];
            type: 'u64';
          },
          {
            name: 'checkpointPrincipal';
            type: 'u128';
          },
          {
            name: 'checkpointInterest';
            type: 'u128';
          },
          {
            name: 'checkpointPenalty';
            type: 'u128';
          },
          {
            name: 'checkpointPrepaymentFee';
            type: 'u128';
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'recoveryCostRecorded';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'totalCosts';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'refundWithdrawn';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'repaymentProcessed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'received';
            type: 'u64';
          },
          {
            name: 'recovery';
            type: 'u64';
          },
          {
            name: 'interest';
            type: 'u64';
          },
          {
            name: 'principal';
            type: 'u64';
          },
          {
            name: 'penalty';
            type: 'u64';
          },
          {
            name: 'advance';
            type: 'u64';
          },
          {
            name: 'repaid';
            type: 'bool';
          },
        ];
      };
    },
    {
      name: 'scheduleFinalized';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'periodCount';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'schedulePeriodsAdded';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'campaignId';
            type: 'u64';
          },
          {
            name: 'totalPeriods';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'scheduleType';
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'annuity';
          },
          {
            name: 'coupon';
          },
        ];
      };
    },
    {
      name: 'userAccount';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'platform';
            type: 'pubkey';
          },
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'entityType';
            docs: ['Хранится для бэкенда, логика программы его не использует.'];
            type: {
              defined: {
                name: 'entityType';
              };
            };
          },
          {
            name: 'withdrawalAddress';
            docs: [
              'Единственный адрес для любых выплат пользователю (владелец, не токен-счёт).',
            ];
            type: 'pubkey';
          },
          {
            name: 'whitelistStatus';
            type: 'bool';
          },
          {
            name: 'withdrawalAddressChangedAt';
            docs: ['0 для нового аккаунта.'];
            type: 'i64';
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'userCreated';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'entityType';
            type: {
              defined: {
                name: 'entityType';
              };
            };
          },
          {
            name: 'withdrawalAddress';
            type: 'pubkey';
          },
          {
            name: 'whitelistStatus';
            type: 'bool';
          },
        ];
      };
    },
    {
      name: 'whitelistChanged';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'whitelistStatus';
            type: 'bool';
          },
        ];
      };
    },
    {
      name: 'withdrawalAddressChanged';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'userId';
            type: {
              array: ['u8', 16];
            };
          },
          {
            name: 'withdrawalAddress';
            type: 'pubkey';
          },
        ];
      };
    },
  ];
};
