/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/dala_actions.json`.
 */
export type DalaActions = {
  "address": "7JZq4xxCLMaRefYwqgqh78skXkWrf4rtU6ArRjiokrjV",
  "metadata": {
    "name": "dalaActions",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Корпоративные действия по токенизированным облигациям Dala Capital"
  },
  "instructions": [
    {
      "name": "burnFromHolder",
      "docs": [
        "Гасит бумаги держателя: при возврате взноса или при погашении займа.",
        "",
        "Прожиг, а не пометка: обнулённый supply виден в любом обозревателе, и",
        "доказывать его нашей программой не нужно. Когда в обращении не остаётся",
        "ничего, выпуск закрывается."
      ],
      "discriminator": [
        127,
        115,
        167,
        67,
        38,
        139,
        202,
        134
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "holder"
        },
        {
          "name": "holderToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
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
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "redemption",
          "type": "bool"
        }
      ]
    },
    {
      "name": "cancelBond",
      "docs": [
        "Аннулирует выпуск: сбор не состоялся, взносы вернулись, бумаги сожжены",
        "без погашения. Отдельное состояние нужно потому, что иначе такой выпуск",
        "в сети неотличим от пустого нового — у обоих ноль в обращении."
      ],
      "discriminator": [
        81,
        78,
        26,
        248,
        139,
        167,
        249,
        246
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeAction",
      "docs": [
        "Закрывает действие. Снимок реестра закрывается сразу после записи:",
        "у него нет исполнения, он сам по себе результат."
      ],
      "discriminator": [
        68,
        91,
        38,
        183,
        124,
        74,
        239,
        136
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "registry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u32"
        }
      ]
    },
    {
      "name": "declareAction",
      "docs": [
        "Объявляет корпоративное действие. Дата фиксации назначается заранее:",
        "держатели должны знать её до того, как реестр снят."
      ],
      "discriminator": [
        141,
        188,
        155,
        223,
        245,
        152,
        128,
        31
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "actionKind"
            }
          }
        },
        {
          "name": "recordTs",
          "type": "i64"
        },
        {
          "name": "paymentTs",
          "type": "i64"
        },
        {
          "name": "amountPerUnit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "issueBond",
      "docs": [
        "Выпускает облигацию: создаёт минт с расширениями, пишет в него условия",
        "и заводит реестр. Бумаг пока ноль — выпуск открыт, но никто не вложился."
      ],
      "discriminator": [
        89,
        175,
        93,
        128,
        140,
        237,
        182,
        162
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "которых типизированный `init` не умеет."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "bondParams"
            }
          }
        }
      ]
    },
    {
      "name": "mintToHolder",
      "docs": [
        "Выдаёт бумаги инвестору сразу после зачтённого взноса.",
        "",
        "Счёт держателя создаётся замороженным — таково условие выпуска, — но на",
        "замороженный счёт нельзя начислить, поэтому регистратор размораживает",
        "его на время начисления и тут же замораживает обратно."
      ],
      "discriminator": [
        85,
        175,
        9,
        233,
        36,
        148,
        193,
        213
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "holder"
        },
        {
          "name": "holderToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
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
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "units",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recordSnapshot",
      "docs": [
        "Записывает снятый реестр: сколько держателей, сколько бумаг и хеш",
        "списка. Сам список публикуется платформой — по хешу любой проверит,",
        "что реестр не подменили задним числом."
      ],
      "discriminator": [
        173,
        85,
        25,
        110,
        31,
        124,
        59,
        136
      ],
      "accounts": [
        {
          "name": "operator",
          "signer": true
        },
        {
          "name": "registry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "holders",
          "type": "u32"
        },
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "totalAmount",
          "type": "u64"
        },
        {
          "name": "registerHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setBondStatus",
      "docs": [
        "Переводит выпуск во взыскание или возвращает в обычное состояние.",
        "Само решение принимается в `dala_capital`, здесь оно отражается на бумаге."
      ],
      "discriminator": [
        47,
        192,
        252,
        230,
        162,
        108,
        139,
        22
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "defaulted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleAction",
      "docs": [
        "Отмечает действие исполненным и прикладывает подпись расчётной",
        "транзакции из `dala_capital`. Деньги прошли там — здесь остаётся",
        "проверяемая ссылка на них. Для голосования сюда же ложится итог."
      ],
      "discriminator": [
        10,
        58,
        136,
        98,
        207,
        113,
        239,
        90
      ],
      "accounts": [
        {
          "name": "operator",
          "signer": true
        },
        {
          "name": "registry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "settlement",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "votesFor",
          "type": "u64"
        },
        {
          "name": "votesAgainst",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "actionRecord",
      "discriminator": [
        181,
        208,
        202,
        70,
        127,
        154,
        115,
        80
      ]
    },
    {
      "name": "registry",
      "discriminator": [
        47,
        174,
        110,
        246,
        184,
        182,
        252,
        218
      ]
    }
  ],
  "events": [
    {
      "name": "actionClosed",
      "discriminator": [
        12,
        207,
        175,
        173,
        7,
        142,
        107,
        78
      ]
    },
    {
      "name": "actionDeclared",
      "discriminator": [
        198,
        225,
        223,
        123,
        36,
        224,
        144,
        33
      ]
    },
    {
      "name": "actionSettled",
      "discriminator": [
        104,
        222,
        224,
        188,
        243,
        117,
        196,
        135
      ]
    },
    {
      "name": "bondIssued",
      "discriminator": [
        42,
        215,
        210,
        134,
        104,
        101,
        194,
        60
      ]
    },
    {
      "name": "bondStatusChanged",
      "discriminator": [
        194,
        110,
        13,
        75,
        26,
        105,
        17,
        230
      ]
    },
    {
      "name": "snapshotRecorded",
      "discriminator": [
        238,
        89,
        139,
        114,
        10,
        83,
        172,
        36
      ]
    },
    {
      "name": "unitsBurned",
      "discriminator": [
        42,
        95,
        38,
        222,
        211,
        129,
        9,
        122
      ]
    },
    {
      "name": "unitsMinted",
      "discriminator": [
        132,
        101,
        101,
        254,
        218,
        197,
        154,
        208
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Операцию подписал не тот ключ"
    },
    {
      "code": 6001,
      "name": "bondRedeemed",
      "msg": "Выпуск уже погашен"
    },
    {
      "code": 6002,
      "name": "bondsOutstanding",
      "msg": "Бумаги ещё в обращении"
    },
    {
      "code": 6003,
      "name": "supplyExceeded",
      "msg": "Нельзя выпустить больше, чем предусмотрено условиями"
    },
    {
      "code": 6004,
      "name": "invalidAmount",
      "msg": "Нечего выпускать или гасить: сумма должна быть больше нуля"
    },
    {
      "code": 6005,
      "name": "notEnoughUnits",
      "msg": "У держателя меньше бумаг, чем указано"
    },
    {
      "code": 6006,
      "name": "recordDateNotReached",
      "msg": "Дата фиксации ещё не наступила"
    },
    {
      "code": 6007,
      "name": "invalidDates",
      "msg": "Дата фиксации должна быть раньше даты исполнения"
    },
    {
      "code": 6008,
      "name": "invalidActionStatus",
      "msg": "Действие в неподходящем состоянии"
    },
    {
      "code": 6009,
      "name": "snapshotMissing",
      "msg": "Реестр по действию ещё не снят"
    },
    {
      "code": 6010,
      "name": "invalidBondParams",
      "msg": "Условия выпуска заданы неверно"
    },
    {
      "code": 6011,
      "name": "mathOverflow",
      "msg": "Переполнение при расчёте"
    }
  ],
  "types": [
    {
      "name": "actionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "actionStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "actionDeclared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "recordTs",
            "type": "i64"
          },
          {
            "name": "paymentTs",
            "type": "i64"
          },
          {
            "name": "amountPerUnit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "actionKind",
      "docs": [
        "Вид корпоративного действия. Перечисление открытое: дивиденд, выкуп или",
        "изменение условий добавляются сюда, а механика снимка и записи не меняется."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "record"
          },
          {
            "name": "coupon"
          },
          {
            "name": "redemption"
          },
          {
            "name": "vote"
          },
          {
            "name": "default"
          },
          {
            "name": "recovery"
          }
        ]
      }
    },
    {
      "name": "actionRecord",
      "docs": [
        "Корпоративное действие: объявление, снятый реестр и итог."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "recordTs",
            "docs": [
              "На кого распространяется действие: реестр снимается по состоянию на эту дату."
            ],
            "type": "i64"
          },
          {
            "name": "paymentTs",
            "docs": [
              "Когда действие исполняется."
            ],
            "type": "i64"
          },
          {
            "name": "amountPerUnit",
            "docs": [
              "Сумма на бумагу; у голосования — одобренный предел расходов на взыскание."
            ],
            "type": "u64"
          },
          {
            "name": "holders",
            "docs": [
              "Итоги снятого реестра."
            ],
            "type": "u32"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "registerHash",
            "docs": [
              "Хеш опубликованного списка держателей: по нему любой проверит реестр."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "settlement",
            "docs": [
              "Подпись расчётной транзакции в `dala_capital` — деньги прошли там."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "votesFor",
            "docs": [
              "Итог голосования в бумагах; у остальных видов нули."
            ],
            "type": "u64"
          },
          {
            "name": "votesAgainst",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "actionStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "actionSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "actionKind"
              }
            }
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "votesFor",
            "type": "u64"
          },
          {
            "name": "votesAgainst",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "actionStatus",
      "docs": [
        "Стадии действия. Порядок проверяет программа: записать исполнение, не сняв",
        "реестр, нельзя — иначе «кому платили» осталось бы недоказуемым."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "declared"
          },
          {
            "name": "snapshot"
          },
          {
            "name": "settled"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "bondIssued",
      "docs": [
        "События — неизменная история выпуска. Состояние живёт в аккаунтах, а эти",
        "записи остаются в транзакциях навсегда и доказывают, что и когда было."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "faceValue",
            "type": "u64"
          },
          {
            "name": "couponRateBps",
            "type": "u32"
          },
          {
            "name": "couponsPerYear",
            "type": "u8"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "maxSupply",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bondParams",
      "docs": [
        "Условия выпуска. Приходят из кампании `dala_capital`, но дальше живут",
        "самостоятельно: бумага не должна зависеть от того, что мы помним о сделке."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "faceValue",
            "type": "u64"
          },
          {
            "name": "couponRateBps",
            "type": "u32"
          },
          {
            "name": "couponsPerYear",
            "type": "u8"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "maxSupply",
            "type": "u64"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "isin",
            "docs": [
              "Идентификатор бумаги по ISO 6166 — двенадцать знаков с контрольной",
              "цифрой. Для биржи бумага без него не бумага."
            ],
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "bondStatus",
      "docs": [
        "Жизнь выпуска. `Defaulted` — не конец: право требования живёт, пока идёт",
        "взыскание, и бумаги гасятся только когда дело закрыто."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "defaulted"
          },
          {
            "name": "redeemed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "bondStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "bondStatusView"
              }
            }
          }
        ]
      }
    },
    {
      "name": "bondStatusView",
      "docs": [
        "Отдельный вид для события: в событиях удобнее плоское перечисление."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "defaulted"
          },
          {
            "name": "redeemed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "registry",
      "docs": [
        "Выпуск облигации: условия бумаги и сколько её в обращении.",
        "",
        "Те же условия записаны в метаданные минта — там источник правды для",
        "внешнего мира, здесь они нужны программе для проверок."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Админ платформы: выпускает бумагу, объявляет и закрывает действия."
            ],
            "type": "pubkey"
          },
          {
            "name": "operator",
            "docs": [
              "Операторский ключ: кранки выпуска, прожига и снятия реестра."
            ],
            "type": "pubkey"
          },
          {
            "name": "campaignId",
            "docs": [
              "Номер кампании в `dala_capital`, по которой выпущена бумага."
            ],
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "docs": [
              "Расчётный токен кампании: справочно, деньги ходят в `dala_capital`."
            ],
            "type": "pubkey"
          },
          {
            "name": "faceValue",
            "docs": [
              "Номинал одной бумаги в минимальных единицах расчётного токена."
            ],
            "type": "u64"
          },
          {
            "name": "couponRateBps",
            "type": "u32"
          },
          {
            "name": "couponsPerYear",
            "type": "u8"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "maxSupply",
            "docs": [
              "Потолок выпуска: максимум сбора кампании, делённый на номинал."
            ],
            "type": "u64"
          },
          {
            "name": "isin",
            "docs": [
              "Идентификатор бумаги по ISO 6166; пусто, пока не присвоен. Лежит и",
              "здесь, и в метаданных минта: читать условия выпуска одним запросом",
              "удобнее, а расходиться им неоткуда — пишутся вместе."
            ],
            "type": "string"
          },
          {
            "name": "issued",
            "docs": [
              "Всего выпущено за всё время и сколько сейчас в обращении."
            ],
            "type": "u64"
          },
          {
            "name": "outstanding",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "bondStatus"
              }
            }
          },
          {
            "name": "actions",
            "docs": [
              "Счётчик корпоративных действий: из него берётся номер следующего."
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mintBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "snapshotRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "holders",
            "type": "u32"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "registerHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "unitsBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "outstanding",
            "type": "u64"
          },
          {
            "name": "redemption",
            "docs": [
              "true — погашение бумаги, false — возврат взноса по несостоявшемуся сбору."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "unitsMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignId",
            "type": "u64"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "outstanding",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
