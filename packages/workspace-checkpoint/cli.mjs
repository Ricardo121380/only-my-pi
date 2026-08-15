import { runCli } from './index.mjs';

try {
  const result = await runCli(process.argv.slice(2));
  if (result?.help) process.stdout.write(`${result.help}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
