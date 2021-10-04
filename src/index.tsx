import type { CfAccount, CfModuleType, CfScriptFormat } from "./api/worker";

import React from "react";
import { render } from "ink";
import { App } from "./app";
import { readFile, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import makeCLI from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import cloudflareAPI from "cloudflare";
import type yargs from "yargs";
import { findUp } from "find-up";
import TOML from "@iarna/toml";
import type { Config } from "./config";
import { login, logout, listScopes } from "./user";

let apiToken: string | void;
function getAPI() {
  try {
    apiToken = /(oauth|api)_token = "([a-zA-Z0-9_\-.]*)"/.exec(
      readFileSync(
        path.join(os.homedir(), ".wrangler/config/default.toml"),
        "utf-8"
      )
    )[2];
  } catch (err) {
    console.error("could not parse api token");
    throw err;
  }
  if (!apiToken) {
    throw new Error("missing api token");
  }
  // @ts-expect-error `cloudflareAPI`'s type says it's not callable, but clearly it is.
  return cloudflareAPI({
    token: apiToken,
  });
}

async function readConfig(path?: string): Promise<Config | void> {
  if (!path) {
    path = await findUp("wrangler.toml");
    // TODO - terminate this early instead of going all the way to the root
  }
  if (!path) {
    // TODO: a default config?
    return;
  }
  const tml: string = await new Promise((resolve, reject) => {
    readFile(path, "utf-8", (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const parsed = TOML.parse(tml) as Config;
  console.log(parsed);
  // todo: validate, add defaults
  // let's just do some basics for now
  parsed.account_id ||= process.env.CF_ACCOUNT_ID;
  if (!parsed.account_id) {
    throw new Error("Missing account id");
  }

  return parsed;
}

// a helper to demand one of a set of options
// via https://github.com/yargs/yargs/issues/1093#issuecomment-491299261
function demandOneOfOption(...options: string[]) {
  return function (argv: yargs.Arguments) {
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
    (yargs) => {
      // TODO: This needs some copy editing
      // I mean, this entire app does, but this too.
      return yargs
        .option("scopes-list", {
          describe: "list all the available OAuth scopes with descriptions.",
        })
        .option("scopes", {
          describe: "allows to choose your set of OAuth scopes.",
          array: true,
          type: "string",
        });

      // TODO: scopes
    },
    async (args) => {
      console.log(":login", args);
      if (args["scopes-list"]) {
        listScopes();
        return;
      }
      if (args.scopes) {
        if (args.scopes.length === 0) {
          // don't allow no scopes to be passed, that would be weird
          listScopes();
          return;
        }
        await login({ scopes: args.scopes });
        return;
      }
      await login();

      // TODO: would be nice if it optionally saved login
      // creds inside node_modules/.cache or something
      // this way you could have multiple users on a single machine
    }
  );

  // logout
  yargs.command(
    // this needs scopes as an option?
    "logout",
    "🚪 Logout from Cloudflare",
    () => {},
    async (args) => {
      console.log(":logout", args);
      await logout();
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
  yargs.command(
    "publish",
    "🆙 Publish your Worker to Cloudflare.",
    (yargs) => {
      return yargs.option("env", {
        type: "string",
        describe: "Perform on a specific environment",
      });
    },
    (args) => {
      console.log(":publish", args);
    }
  );

  // dev
  yargs.command(
    "dev <filename>",
    "👂 Start a local server for developing your worker",
    (yargs) => {
      return yargs
        .positional("filename", { describe: "entry point", type: "string" })
        .option("format", {
          default: "modules",
          choices: ["modules", "service-worker"] as const,
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
      if (!apiToken) {
        throw new Error("missing API token");
      }

      render(
        <App
          entry={filename}
          options={options}
          account={{
            accountId: (args.config as Config).account_id,
            apiToken,
          }}
        />
      );
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
    "subdomain [name]",
    "👷 Create or change your workers.dev subdomain.",
    (yargs) => {
      return yargs.positional("name", { type: "string" });
    },
    (args) => {
      console.log(":subdomain", args);
      if (!args.name) {
        // get
      } else {
        // put
      }
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
          async (args) => {
            console.log(":kv:namespace create", args);
            if (args._.length !== 2) {
              throw new Error(
                `Did you forget to add quotes around "${
                  args.namespace
                } ${args._.slice(2).join(" ")}"?`
              );
            }
            const config = args.config as Config;

            const title = `${config.name}${args.env ? `-${args.env}` : ""}'-'${
              args.namespace
            }${args.preview ? "_preview" : ""}`;

            if (/[\W]+/.test(args.namespace)) {
              throw new Error("invalid binding name, needs to be js friendly");
            }

            // TODO: generate a binding name stripping non alphanumeric chars

            console.log(`🌀 Creating namespace with title "${title}"`);
            const api = getAPI();

            const response = await api.enterpriseZoneWorkersKVNamespaces.add(
              config.account_id,
              { title }
            );
            console.log(response);
            if (response.success) {
              console.log("✨ Success!");
              console.log(
                `Add the following to your configuration file in your kv_namespaces array${
                  args.env ? ` under [env.${args.env}]` : ""
                }:`
              );
              console.log(
                `{ binding = "${args.namespace}", ${
                  args.preview ? "preview_" : ""
                }id = ${response.result.id} }`
              );
            }
          }
        )
        .command(
          "list",
          "Outputs a list of all KV namespaces associated with your account id.",
          {},
          async (args) => {
            console.log(":kv:namespace list", args);
            const api = getAPI();
            // TODO: we should show bindings if they exist for given ids
            console.log(
              await api.enterpriseZoneWorkersKVNamespaces.browse(
                (args.config as Config).account_id
              )
            );
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
            const id =
              args["namespace-id"] ||
              (args.env
                ? (args.config as Config)[`env.${args.env}`]
                : (args.config as Config)
              ).kv_namespaces.find(
                (namespace) => namespace.binding === args.binding
              )[args.preview ? "preview_id" : "id"];
            if (!id) {
              throw new Error("Are your sure? id not found");
            }
            const api = getAPI();
            api.enterpriseZoneWorkersKVNamespaces.del(
              (args.config as Config).account_id,
              id
            );

            // TODO: recommend they remove it from wrangler.toml
            // TODO: do it automatically
            // TODO: delete the preview namespace as well?
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

  yargs.option("config", {
    describe: "Path to .toml configuration file",
    type: "string",
    async coerce(arg) {
      return readConfig(arg);
    },
  });

  yargs.group(["config", "help", "version"], "Flags:");

  yargs.parse();

  // yargs.version("0.0.0");
}
