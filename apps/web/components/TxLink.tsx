const EXPLORER = "https://explorer.testnet.arc.io";

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-brand-400 hover:text-brand-300 underline break-all"
    >
      {label ?? `${hash.slice(0, 10)}…${hash.slice(-8)}`}
    </a>
  );
}
