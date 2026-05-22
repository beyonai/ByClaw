import { runAimodelSecretResolverCli } from "./aimodel-secret-resolver.js";

runAimodelSecretResolverCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
