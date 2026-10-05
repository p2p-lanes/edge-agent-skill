export async function aws(args: string[]): Promise<string> {
  const proc = Bun.spawn(["aws", ...args, "--no-cli-pager"], { stdout: "pipe", stderr: "pipe" });
  const [exit, output, error] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (exit !== 0) throw new Error(`AWS ${args[0]} ${args[1]} failed: ${error.trim()}`);
  return output.trim();
}

export async function run(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [exit, output] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (exit !== 0) throw new Error(`${args[0]} failed (${exit})`);
  return output.trim();
}
