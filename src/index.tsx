import type { CfAccount, CfModuleType, CfScriptFormat } from "./api/worker";

import React from "react";
import { render } from "ink";
import { App } from "./app";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import makeCLI from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { cloudflare } from "../package.json";
import cloudflareAPI from "cloudflare";

const apiToken = /api_token = "([a-zA-Z0-9_-]*)"/.exec(
  readFileSync(
    path.join(os.homedir(), ".wrangler/config/default.toml"),
    "utf-8"
  )
)[1];

if (!cloudflare.account || !apiToken) {
  throw new Error("missing account or api token (and optionally CF_ZONE_ID)");
}

const account: CfAccount = {
  accountId: cloudflare.account,
  zoneId: cloudflare.zone,
  apiToken: apiToken,
};

const api = cloudflareAPI({
  token: apiToken,
});

// a helper to demand one of a set of options
// via https://github.com/yargs/yargs/issues/1093#issuecomment-491299261
function demandOneOfOption(...options: string[]) {
  return function (argv) {
    const count = options.filter((option) => argv[option]).length;
    const lastOption = options.pop();

    if (count === 0) {
      throw new Error(
        `Exactly one of the arguments ${options.join(
          ", "
        )} and ${lastOption} is required`
      );
    } else if (count > 1) {
      throw new Error(
        `Arguments ${options.join(
          ", "
        )} and ${lastOption} are mutually exclusive`
      );
    }

    return true;
  };
}

export async function main(): Promise<void> {
  const yargs = makeCLI(hideBin(process.argv))
    .scriptName("wrangler")
    .wrap(null);

  // you will note that we use the form for all commands where we use the builder function
  // to define options and subcommands. Further we return the result of this builder even
  // tho it's not completely necessary. The reason is that it's required for type inference
  // of the args in the handle function.I wish we could enforce this pattern, but this
  // comment will have to do for now.

  // also annoying that choices[] doesn't get inferred as an enum. bleh.

  // [DEPRECATED] generate
  yargs.command(
    // we definitely want to move away from us cloning github templates
    // we can do something better here, let's see
    "generate [name] [template]",
    "👯 [DEPRECATED]. Scaffold a Cloudflare Workers project from a public GitHub repository.",
    (yargs) => {
      return yargs
        .positional("name", {
          describe: "Name of the Workers project",
          default: "worker",
        })
        .positional("template", {
          describe: "a link to a GitHub template",
          default: "https://github.com/cloudflare/worker-template",
        })
        .option("type", {
          default: "javascript",
          describe: "The type of project you want generated.",
          choices: ["webpack", "javascript", "rust"],
        })
        .option(
          // we'll want to deprecate/replace this with Pages
          "site",
          {
            describe:
              "Initialise as a Workers Sites project. Overrides `type` and `template`",
          }
        );
    },
    (args) => {
      console.log(":generate", args);
    }
  );

  // init
  yargs.command(
    "init [name]",
    "📥 Create a wrangler.toml for an existing project",
    (yargs) => {
      return yargs
        .positional("name", {
          describe: "The name of your worker.",
          type: "string",
          // TODO: default: <name of working directory>
        })
        .positional("template", {
          type: "string",
          describe:
            "GitHub URL of the repo to use as the template for generating the project.",
        })
        .option(
          // we'll want to deprecate this option, it should effectively be
          // "javascript" (i.e - custom builds) for all
          "type",
          {
            describe: "The type of project you want to generate",
            choices: ["javascript", "webpack", "rust"],
            default: "javascript",
          }
        )
        .option(
          // we'll want to deprecate/replace this with Pages
          "site",
          {
            describe: "Initialise a Workers Sites project",
            type: "boolean",
          }
        );
    },
    (args) => {
      console.log(":init", args);
    }
  );

  // build
  yargs.command(
    "build",
    "🦀 Build your project (if applicable)",
    (yargs) => {
      return yargs.option("env", {
        describe: "Perform on a specific environment",
      });
    },
    (args) => {
      console.log(":build", args);
    }
  );

  // login
  yargs.command(
    // this needs scopes as an option?
    "login",
    "🔓 Login to Cloudflare",
    () => {},
    (args) => {
      console.log(":login", args);
    }
  );

  // whoami
  yargs.command(
    "whoami",
    "🕵️  Retrieve your user info and test your auth config",
    () => {},
    (args) => {
      console.log(":whoami", args);
    }
  );

  // config
  yargs.command(
    "config",
    "🕵️  [DEPRECATED] Authenticate Wrangler by prompting you for a Cloudflare API Token or Global API key.",
    (yargs) => {
      return yargs.option("api-key", {
        type: "string",
        describe: "Provide email and Global API key (not recommended)",
      });
    },
    (args) => {
      console.log(":config", args);
    }
  );

  // publish
  yargs.command("publish", "🆙 Publish your Worker to Cloudflare.", (yargs) => {
    return yargs.option("env", {
      type: "string",
      describe: "Perform on a specific environment",
    });
  });

  // dev
  yargs.command(
    "dev <filename>",
    "👂 Start a local server for developing your worker",
    (yargs) => {
      return yargs
        .positional("filename", { describe: "entry point", type: "string" })
        .option("format", {
          default: "modules",
          choices: ["modules", "service-worker"],
          describe: "Choose an entry type",
        })
        .option("env", {
          describe: "Perform on a specific environment",
          type: "string",
          // TODO: get choices for the toml file?
        })
        .option("ip", {
          describe: "IP address to listen on",
          type: "string",
          default: "127.0.0.1",
        })
        .option("port", {
          describe: "Port to listen on, defaults to 8787",
          type: "number",
          default: 8787,
        })
        .option("host", {
          type: "string",
          describe:
            "Host to forward requests to, defaults to the zone of project or to tutorial.cloudflareworkers.com if unauthenticated",
        })
        .option("local", {
          type: "boolean",
          describe: "Run program locally",
          default: false,
        })
        .option("local-protocol", {
          default: "http",
          describe: "Protocol to listen to requests on, defaults to http.",
          choices: ["http", "https"],
        })
        .option("upstream-protocol", {
          default: "https",
          describe:
            "Protocol to forward requests to host on, defaults to https.",
          choices: ["http", "https"],
        });
    },
    async (args) => {
      const { filename, format } = args;
      const options = {
        format: format as CfScriptFormat,
        type: "esm" as CfModuleType,
      };

      render(<App entry={filename} options={options} account={account} />);
    }
  );

  // tail
  yargs.command(
    "tail",
    "🦚 Starts a log tailing session for a deployed Worker.",
    (yargs) => {
      return yargs
        .option("format", {
          default: "json",
          choices: ["json", "pretty"],
          describe: "The format of log entries",
        })
        .option("status", {
          choices: ["ok", "error", "canceled"],
          describe:
            "Filter by invocation status (possible values: ok, error, canceled)",
        })
        .option("header", {
          type: "string",
          describe: "Filter by HTTP header",
        })
        .option("method", {
          type: "string",
          describe: "Filter by HTTP method",
        })
        .option("sampling-rate", {
          type: "number",
          describe: "Adds a percentage of requests to log sampling rate",
        })
        .option("search", {
          type: "string",
          describe: "Filter by a text match in console.log messages",
        });
    },
    (args) => {
      console.log(":tail", args);
    }
  );

  // preview
  yargs.command(
    "preview [method] [body]",
    "🔬 [DEPRECATED] Preview your code temporarily on cloudflareworkers.com",
    (yargs) => {
      return yargs
        .positional("method", {
          describe: "Type of request to preview your worker",
          choices: ["GET", "POST"],
          default: ["GET"],
        })
        .positional("body", {
          type: "string",
          describe: "Body string to post to your preview worker request.",
          default: "Null",
        })
        .option("env", {
          type: "string",
          describe: "Perform on a specific environment",
        })
        .option("watch", {
          default: true,
          describe: "Enable live preview",
          type: "boolean",
        });
    },
    (args) => {
      console.log(":preview", args);
    }
  );

  // route
  yargs.command("route", "➡️  List or delete worker routes", (yargs) => {
    return yargs
      .command(
        "list",
        "List a route associated with a zone",
        (yargs) => {
          return yargs.option("env", {
            type: "string",
            describe: "Perform on a specific environment",
          });
        },
        (args) => {
          console.log(":route list", args);
        }
      )
      .command(
        "delete <id>",
        "Delete a route associated with a zone",
        (yargs) => {
          return yargs
            .positional("id", {
              describe: "The hash of the route ID to delete.",
              type: "string",
            })
            .option("env", {
              type: "string",
              describe: "Perform on a specific environment",
            });
        },
        (args) => {
          console.log(":route delete", args);
        }
      );
  });

  // subdomain
  yargs.command(
    "subdomain <name>",
    "👷 Create or change your workers.dev subdomain.",
    (yargs) => {
      return yargs.positional("name", { type: "string" });
    },
    (args) => {
      console.log(":subdomain", args);
    }
  );

  // secret
  yargs.command(
    "secret",
    "🤫 Generate a secret that can be referenced in the worker script",
    (yargs) => {
      return yargs
        .command(
          "put <name>",
          "create or replace a secret",
          (yargs) => {
            return yargs
              .positional("name", {
                describe: "The variable name to be accessible in the script.",
                type: "string",
              })
              .option("env", {
                type: "string",
                describe:
                  "Binds the secret to the script of the specific environment.",
              });
          },
          (args) => {
            console.log(":secret put", args);
          }
        )
        .command(
          "delete <name>",
          "delete a secret from a specific script",
          (yargs) => {
            return yargs
              .positional("name", {
                describe: "The variable name to be accessible in the script.",
                type: "string",
              })
              .option("env", {
                type: "string",
                describe:
                  "Binds the secret to the script of the specific environment.",
              });
          },
          (args) => {
            console.log(":secret delete", args);
          }
        );
    }
  );

  // kv
  // :namespace
  yargs.command(
    "kv:namespace",
    "🗂️  Interact with your Workers KV Namespaces",
    (yargs) => {
      return yargs
        .command(
          "create <namespace>",
          "Create a new namespace",
          (yargs) => {
            return yargs
              .positional("namespace", {
                describe: "The name of the new namespace",
                type: "string",
              })
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("preview", {
                type: "boolean",
                describe: "Interact with a preview namespace",
              });
          },
          (args) => {
            console.log(":kv:namespace create", args);
          }
        )
        .command(
          "list",
          "Outputs a list of all KV namespaces associated with your account id.",
          {},
          (args) => {
            console.log(":kv:namespace list", args);
          }
        )
        .command(
          "delete",
          "Deletes a given namespace.",
          (yargs) => {
            return yargs
              .option("binding", {
                type: "string",
                describe: "The name of the namespace to delete",
              })
              .option("namespace-id", {
                type: "string",
                describe: "The id of the namespace to delete",
              })
              .check(demandOneOfOption("binding", "namespace-id"))
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("preview", {
                type: "boolean",
                describe: "Interact with a preview namespace",
              });
          },
          (args) => {
            console.log(":kv:namespace delete", args);
          }
        );
    }
  );

  // :key
  yargs.command(
    "kv:key",
    "🔑 Individually manage Workers KV key-value pairs",
    (yargs) => {
      return yargs
        .command(
          "put <key> <value>",
          "Writes a single key/value pair to the given namespace.",
          (yargs) => {
            return yargs
              .positional("key", {
                type: "string",
                describe: "The key to write to.",
              })
              .positional("value", {
                type: "string",
                describe: "The value to write.",
              })
              .option("binding", {
                type: "string",
                describe: "The name of the namespace to write to.",
              })
              .option("namespace-id", {
                type: "string",
                describe: "The id of the namespace to write to.",
              })
              .check(demandOneOfOption("binding", "namespace-id"))
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("preview", {
                type: "boolean",
                describe: "Interact with a preview namespace",
              })
              .option("ttl", {
                type: "number",
                describe: "Time for which the entries should be visible.",
              })
              .option("expiration", {
                type: "number",
                describe:
                  "Time since the UNIX epoch after which the entry expires",
              })
              .option("path", {
                type: "string",
                describe: "Read value from the file at a given path.",
              });
          },
          (args) => {
            console.log(":kv:key put", args);
          }
        )
        .command(
          "list",
          "Outputs a list of all keys in a given namespace.",
          (yargs) => {
            return yargs
              .option("binding", {
                type: "string",
                describe: "The name of the namespace to list",
              })
              .option("namespace-id", {
                type: "string",
                describe: "The id of the namespace to list",
              })
              .check(demandOneOfOption("binding", "namespace-id"))
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("prefix", {
                type: "boolean",
                describe: "A prefix to filter listed keys",
              });
          },
          (args) => {
            console.log(":kv:key list", args);
          }
        )
        .command(
          "get <key>",
          "Reads a single value by key from the given namespace.",
          (yargs) => {
            return yargs
              .positional("key", {
                describe: "The key value to get.",
                type: "string",
              })
              .option("binding", {
                type: "string",
                describe: "The name of the namespace to get from",
              })
              .option("namespace-id", {
                type: "string",
                describe: "The id of the namespace to get from",
              })
              .check(demandOneOfOption("binding", "namespace-id"))
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("preview", {
                type: "boolean",
                describe: "Interact with a preview namespace",
              });
          },
          (args) => {
            console.log(":kv:key get", args);
          }
        )
        .command(
          "delete <key>",
          "Removes a single key value pair from the given namespace.",
          (yargs) => {
            return yargs
              .positional("key", {
                describe: "The key value to delete",
                type: "string",
              })
              .option("binding", {
                type: "string",
                describe: "The name of the namespace to delete from",
              })
              .option("namespace-id", {
                type: "string",
                describe: "The id of the namespace to delete from",
              })
              .check(demandOneOfOption("binding", "namespace-id"))
              .option("env", {
                type: "string",
                describe: "Perform on a specific environment",
              })
              .option("preview", {
                type: "boolean",
                describe: "Interact with a preview namespace",
              });
          },
          (args) => {
            console.log(":kv:key delete", args);
          }
        );
    }
  );

  // :bulk
  yargs.command(
    "kv:bulk put <filename>",
    "💪 Interact with multiple Workers KV key-value pairs at once",
    (yargs) => {
      return yargs
        .positional("filename", {
          describe: "The file to write to the namespace",
          type: "string",
        })
        .option("binding", {
          type: "string",
          describe: "The name of the namespace to put to",
        })
        .option("namespace-id", {
          type: "string",
          describe: "The id of the namespace to put to",
        })
        .check(demandOneOfOption("binding", "namespace-id"))
        .option("env", {
          type: "string",
          describe: "Perform on a specific environment",
        })
        .option("preview", {
          type: "boolean",
          describe: "Interact with a preview namespace",
        });
    },
    (args) => {
      console.log(":kv:bulk put", args);
    }
  );

  // yargs.version("0.0.0");
  yargs.parse();
}
