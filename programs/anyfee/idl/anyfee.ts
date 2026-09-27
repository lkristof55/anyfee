/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/anyfee.json`.
 */
export type Anyfee = {
  "address": "BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M",
  "metadata": {
    "name": "anyfee",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "anyfee: tips and fee routing to GitHub repos, GitHub users and X accounts, keyed by numeric id"
  },
  "instructions": [
    {
      "name": "bind",
      "docs": [
        "Binds (or requests a rebind of) a vault to `claimant`. Requires the immediately",
        "preceding instruction to be an Ed25519SigVerify of `M` by `config.attester`."
      ],
      "discriminator": [
        178,
        57,
        187,
        254,
        138,
        43,
        99,
        134
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "claimant",
          "type": "pubkey"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "cancelRebind",
      "docs": [
        "Current claimant clears a pending rebind."
      ],
      "discriminator": [
        171,
        241,
        9,
        73,
        84,
        123,
        30,
        15
      ],
      "accounts": [
        {
          "name": "claimant",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimSol",
      "docs": [
        "Current claimant withdraws all lamports above rent (minus outstanding tips if declined)."
      ],
      "discriminator": [
        139,
        113,
        179,
        189,
        190,
        30,
        132,
        195
      ],
      "accounts": [
        {
          "name": "claimant",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimToken",
      "docs": [
        "Current claimant withdraws the vault ATA balance (minus outstanding tips if declined)."
      ],
      "discriminator": [
        116,
        206,
        27,
        191,
        166,
        19,
        0,
        73
      ],
      "accounts": [
        {
          "name": "claimant",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
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
          "name": "destination",
          "docs": [
            "Any token account for `config.usdc_mint`, chosen by the claimant."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeTip",
      "docs": [
        "Permissionless crank: closes a tip receipt consumed by a claim; rent back to its sender."
      ],
      "discriminator": [
        22,
        109,
        220,
        105,
        16,
        11,
        112,
        238
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          },
          "relations": [
            "tip"
          ]
        },
        {
          "name": "tip",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "tipIndex"
              }
            ]
          }
        },
        {
          "name": "sender",
          "writable": true,
          "relations": [
            "tip"
          ]
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "tipIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "decline",
      "docs": [
        "Current claimant declines: no new tips, outstanding tips refundable immediately."
      ],
      "discriminator": [
        24,
        57,
        90,
        162,
        91,
        94,
        245,
        177
      ],
      "accounts": [
        {
          "name": "claimant",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeRebind",
      "docs": [
        "Permissionless once the rebind delay has passed."
      ],
      "discriminator": [
        126,
        255,
        92,
        107,
        97,
        125,
        185,
        39
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initVault",
      "docs": [
        "Permissionless; the payer funds rent. Works on an address that already holds lamports."
      ],
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "docs": [
            "Anchor's `init` handles an address that already holds lamports (routed fees sent",
            "before initialization): it tops up to rent exemption, then allocates and assigns",
            "with the PDA signature. Pre-existing lamports stay in the vault and are claimable."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
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
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "One-time setup. The signer must be the program's upgrade authority and becomes admin."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Becomes `config.admin`. Must be the program's upgrade authority, so nobody can",
            "front-run initialization between deploy and initialize."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "attester",
          "type": "pubkey"
        },
        {
          "name": "usdcMint",
          "type": "pubkey"
        },
        {
          "name": "refundWindowSecs",
          "type": "i64"
        },
        {
          "name": "rebindDelaySecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "refundTip",
      "docs": [
        "Permissionless crank: refunds a SOL tip to its sender when the refund rules allow it."
      ],
      "discriminator": [
        66,
        162,
        5,
        255,
        63,
        112,
        0,
        243
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          },
          "relations": [
            "tip"
          ]
        },
        {
          "name": "tip",
          "docs": [
            "Closed on success; its rent goes back to the sender."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "tipIndex"
              }
            ]
          }
        },
        {
          "name": "sender",
          "writable": true,
          "relations": [
            "tip"
          ]
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "tipIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundTipToken",
      "docs": [
        "Permissionless crank: refunds a token tip to its sender's ATA when the rules allow it."
      ],
      "discriminator": [
        94,
        227,
        170,
        131,
        201,
        47,
        202,
        56
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          },
          "relations": [
            "tip"
          ]
        },
        {
          "name": "tip",
          "docs": [
            "Closed on success; its rent goes back to the sender."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "tipIndex"
              }
            ]
          }
        },
        {
          "name": "sender",
          "writable": true,
          "relations": [
            "tip"
          ]
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
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
          "name": "senderTokenAccount",
          "docs": [
            "The sender's associated token account for `config.usdc_mint`. If the sender closed it,",
            "the cranker can recreate it first (ATA `create_idempotent`) in the same transaction."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
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
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "tipIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setConfig",
      "docs": [
        "Admin only. `None` keeps a value. Cannot touch vault funds or `usdc_mint`."
      ],
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "attester",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "refundWindowSecs",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "rebindDelaySecs",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "paused",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "tipSol",
      "docs": [
        "Direct SOL tip with a refundable receipt. The vault must exist."
      ],
      "discriminator": [
        111,
        81,
        145,
        255,
        235,
        229,
        103,
        75
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Must already be initialized (prepend `init_vault` if it is not)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "tip",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.tipCount",
                "account": "vault"
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
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "tipToken",
      "docs": [
        "Direct `config.usdc_mint` tip into the vault's ATA (created if missing). The vault must exist."
      ],
      "discriminator": [
        100,
        75,
        23,
        52,
        214,
        128,
        217,
        41
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Must already be initialized (prepend `init_vault` if it is not)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "platform"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "tip",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.tipCount",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "senderTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "The vault's associated token account for `config.usdc_mint`; created if missing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
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
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "platform",
          "type": "u8"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "tip",
      "discriminator": [
        87,
        218,
        38,
        122,
        15,
        197,
        190,
        230
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "bound",
      "discriminator": [
        246,
        254,
        75,
        186,
        240,
        107,
        207,
        246
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "declined",
      "discriminator": [
        59,
        213,
        198,
        187,
        88,
        218,
        236,
        20
      ]
    },
    {
      "name": "rebindCancelled",
      "discriminator": [
        80,
        56,
        71,
        177,
        239,
        223,
        233,
        189
      ]
    },
    {
      "name": "rebindFinalized",
      "discriminator": [
        144,
        32,
        220,
        25,
        244,
        139,
        83,
        221
      ]
    },
    {
      "name": "rebindRequested",
      "discriminator": [
        3,
        210,
        133,
        6,
        88,
        121,
        181,
        63
      ]
    },
    {
      "name": "refunded",
      "discriminator": [
        35,
        103,
        149,
        246,
        196,
        123,
        221,
        99
      ]
    },
    {
      "name": "tipClosed",
      "discriminator": [
        166,
        102,
        250,
        112,
        114,
        189,
        124,
        240
      ]
    },
    {
      "name": "tipped",
      "discriminator": [
        5,
        180,
        227,
        203,
        87,
        116,
        150,
        135
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "vaultDeclined",
      "msg": "Vault has been declined by its claimant; it accepts no new tips"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Program is paused (tips, binds and rebind finalization are disabled)"
    },
    {
      "code": 6002,
      "name": "notClaimant",
      "msg": "Signer is not the vault's claimant"
    },
    {
      "code": 6003,
      "name": "badAttestation",
      "msg": "Attestation message does not match the expected bind message"
    },
    {
      "code": 6004,
      "name": "attestationExpired",
      "msg": "Attestation has expired"
    },
    {
      "code": 6005,
      "name": "rebindNotReady",
      "msg": "Pending rebind is not effective yet"
    },
    {
      "code": 6006,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6007,
      "name": "refundNotYet",
      "msg": "Tip is not refundable yet"
    },
    {
      "code": 6008,
      "name": "tipAlreadySettled",
      "msg": "Tip was already refunded or consumed by a claim"
    },
    {
      "code": 6009,
      "name": "unknownPlatform",
      "msg": "Unknown platform"
    },
    {
      "code": 6010,
      "name": "vaultUnbound",
      "msg": "Vault is not bound to a claimant"
    },
    {
      "code": 6011,
      "name": "noPendingRebind",
      "msg": "Vault has no pending rebind"
    },
    {
      "code": 6012,
      "name": "alreadyClaimant",
      "msg": "Claimant is already bound to this vault"
    },
    {
      "code": 6013,
      "name": "alreadyDeclined",
      "msg": "Vault is already declined"
    },
    {
      "code": 6014,
      "name": "invalidClaimant",
      "msg": "Invalid claimant"
    },
    {
      "code": 6015,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6017,
      "name": "invalidConfig",
      "msg": "Configuration value out of bounds"
    },
    {
      "code": 6018,
      "name": "notAdmin",
      "msg": "Signer is not the admin"
    },
    {
      "code": 6019,
      "name": "notUpgradeAuthority",
      "msg": "Signer is not the program's upgrade authority"
    },
    {
      "code": 6020,
      "name": "missingEd25519Instruction",
      "msg": "The instruction before bind must be an Ed25519SigVerify instruction"
    },
    {
      "code": 6021,
      "name": "malformedEd25519Instruction",
      "msg": "Malformed Ed25519SigVerify instruction (need exactly one signature, all offsets inside the same instruction)"
    },
    {
      "code": 6022,
      "name": "wrongAttester",
      "msg": "Attestation was not signed by the configured attester"
    },
    {
      "code": 6023,
      "name": "notRefundable",
      "msg": "Tip is not refundable: the vault is bound and not declined"
    },
    {
      "code": 6024,
      "name": "wrongTipKind",
      "msg": "Wrong refund instruction for this tip's asset (use refund_tip for SOL, refund_tip_token for tokens)"
    },
    {
      "code": 6025,
      "name": "tipNotConsumed",
      "msg": "Tip has not been consumed by a claim"
    },
    {
      "code": 6026,
      "name": "invalidDestination",
      "msg": "Invalid destination"
    },
    {
      "code": 6027,
      "name": "insufficientVaultBalance",
      "msg": "Vault balance is below its reserved amount"
    }
  ],
  "types": [
    {
      "name": "bound",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "`Pubkey::default()` = SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "consumedTips",
            "docs": [
              "True when this claim consumed the epoch's tips (claim_epoch was incremented)."
            ],
            "type": "bool"
          },
          {
            "name": "claimEpoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global configuration. PDA seeds: `[\"config\"]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "May change attester, windows, pause flag and admin. Can never move vault funds."
            ],
            "type": "pubkey"
          },
          {
            "name": "attester",
            "docs": [
              "ed25519 key whose signature over the bind message `M` authorises `bind`."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "The only SPL mint accepted by `tip_token` / `claim_token` / `refund_tip_token`."
            ],
            "type": "pubkey"
          },
          {
            "name": "refundWindowSecs",
            "docs": [
              "An unbound vault's direct tips become refundable this long after they were sent."
            ],
            "type": "i64"
          },
          {
            "name": "rebindDelaySecs",
            "docs": [
              "Delay between a rebind request and when it can be finalized."
            ],
            "type": "i64"
          },
          {
            "name": "paused",
            "docs": [
              "Blocks new tips, binds and rebind finalization. Never blocks claims, refunds,",
              "cancel_rebind or decline."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attester",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "refundWindowSecs",
            "type": "i64"
          },
          {
            "name": "rebindDelaySecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attester",
            "type": "pubkey"
          },
          {
            "name": "refundWindowSecs",
            "type": "i64"
          },
          {
            "name": "rebindDelaySecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "declined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rebindCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "cancelledClaimant",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rebindFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "oldClaimant",
            "type": "pubkey"
          },
          {
            "name": "newClaimant",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rebindRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "currentClaimant",
            "type": "pubkey"
          },
          {
            "name": "pendingClaimant",
            "type": "pubkey"
          },
          {
            "name": "effectiveAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "refunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "tip",
            "type": "pubkey"
          },
          {
            "name": "tipIndex",
            "type": "u64"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "`Pubkey::default()` = SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tip",
      "docs": [
        "Receipt for one direct tip. PDA seeds: `[\"tip\", vault, tip_index.to_le_bytes()]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "`Pubkey::default()` = SOL; otherwise `config.usdc_mint`."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tipClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "tip",
            "type": "pubkey"
          },
          {
            "name": "tipIndex",
            "type": "u64"
          },
          {
            "name": "sender",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "tip",
            "type": "pubkey"
          },
          {
            "name": "tipIndex",
            "type": "u64"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "`Pubkey::default()` = SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "One vault per (platform, id). PDA seeds: `[\"vault\", [platform], id.to_le_bytes()]`.",
        "",
        "The address is deterministic and can receive lamports (and, through its associated",
        "token account, tokens) before the account is initialized."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "claimant",
            "docs": [
              "`Pubkey::default()` = unbound."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingClaimant",
            "docs": [
              "`Pubkey::default()` = no pending rebind."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingEffectiveAt",
            "type": "i64"
          },
          {
            "name": "boundAt",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "declined",
            "type": "bool"
          },
          {
            "name": "claimEpoch",
            "docs": [
              "+1 on every claim that consumes tips; tips from an older epoch can no longer be refunded."
            ],
            "type": "u64"
          },
          {
            "name": "tipCount",
            "docs": [
              "Number of tips ever received; the next tip's index."
            ],
            "type": "u64"
          },
          {
            "name": "outstandingTipLamports",
            "docs": [
              "Lamports of receipted tips of the current epoch that are not refunded yet."
            ],
            "type": "u64"
          },
          {
            "name": "outstandingTipTokens",
            "docs": [
              "Token base units of receipted tips of the current epoch that are not refunded yet."
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimedLamports",
            "type": "u64"
          },
          {
            "name": "totalClaimedTokens",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "prefundedLamports",
            "docs": [
              "Lamports above rent exemption right after initialization, i.e. routed fees that",
              "reached the address before it was initialized (0 for a fresh address)."
            ],
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "bindDomain",
      "docs": [
        "Domain separator at the start of the attestation message `M`."
      ],
      "type": "bytes",
      "value": "[97, 110, 121, 102, 101, 101, 58, 98, 105, 110, 100, 58, 118, 49]"
    },
    {
      "name": "bindMessageLen",
      "docs": [
        "`M` = domain (14) || program_id (32) || platform (1) || id u64 LE (8) || claimant (32) || expires_at i64 LE (8)."
      ],
      "type": "u16",
      "value": "95"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "defaultRebindDelaySecs",
      "type": "i64",
      "value": "172800"
    },
    {
      "name": "defaultRefundWindowSecs",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "maxRebindDelaySecs",
      "docs": [
        "Upper bound for `rebind_delay_secs` (30 days)."
      ],
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "maxRefundWindowSecs",
      "docs": [
        "Upper bound for `refund_window_secs` (365 days): sender funds are never locked indefinitely."
      ],
      "type": "i64",
      "value": "31536000"
    },
    {
      "name": "minRebindDelaySecs",
      "docs": [
        "Lower bound for `rebind_delay_secs` (1 day): a claimant always has at least a day to cancel",
        "a rebind requested by a compromised attester."
      ],
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "minRefundWindowSecs",
      "docs": [
        "Lower bound for `refund_window_secs` (1 day): tips cannot be bounced before a recipient can react."
      ],
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "platformGithubRepo",
      "type": "u8",
      "value": "2"
    },
    {
      "name": "platformGithubUser",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "platformX",
      "type": "u8",
      "value": "3"
    },
    {
      "name": "tipSeed",
      "type": "bytes",
      "value": "[116, 105, 112]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
