#! /usr/bin/env -S deno run --allow-run --allow-env --allow-read --allow-write --allow-net --unstable-kv

import { Command } from "npm:commander";
import { Console } from "./src/Console.ts";
import { getSettings, getStorage, touchStorageDir } from "./src/System.ts";
import {
  ConfigCommand,
  DiffCommand,
  EditCommand,
  GetCommand,
  InfoCommand,
  ListCommand,
  PathCommand,
  PruneCommand,
  PullCommand,
  PushCommand,
  RemoveCommand,
  ReviewCommand,
  SettingsCommand,
} from "./src/Command.ts";

const console = Console();

export async function main() {
  const storageDir = await touchStorageDir();
  const storage = await getStorage(storageDir)
    .catch((err) => {
      console.error(err);
      console.error("Failed to initialize storage");
      Deno.exit(1);
    });

  const settings = await getSettings(storageDir)
    .catch((err) => {
      console.error(err);
      console.die("Failed to load settings");
    });

  const program = new Command();

  program
    .name("karen")
    .description("KAREN: Assisted Review, Estimation, and Nitpicking")
    .version("1.0.0");

  program
    .addCommand(PathCommand(storageDir))
    .addCommand(SettingsCommand(settings))
    .addCommand(ConfigCommand(storage))
    .addCommand(InfoCommand(storage))
    .addCommand(ListCommand(storage, settings))
    .addCommand(GetCommand(storage))
    .addCommand(RemoveCommand(storage))
    .addCommand(PushCommand(storage))
    .addCommand(PullCommand(storage))
    .addCommand(ReviewCommand(storage, settings))
    .addCommand(EditCommand(storage))
    .addCommand(DiffCommand(storage))
    .addCommand(PruneCommand(storage));

  await program.parseAsync();
}

if (import.meta.main) await main();
