// The worked example used across the site: github.com/octocat/Hello-World (repository id 1296269)
// and its real vault address, derived in the browser with the SDK.
import { Platform, vaultPda } from "@anyfee/sdk";
import { short } from "./format.js";

export const EXAMPLE_ID = 1296269n;
export const EXAMPLE_REPO = "octocat/Hello-World";
export const EXAMPLE_VAULT = vaultPda(Platform.GithubRepo, EXAMPLE_ID)[0].toBase58();
export const DERIVE_PARAMS = { idLabel: String(EXAMPLE_ID), addrLabel: short(EXAMPLE_VAULT) };
