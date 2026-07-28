// P2P connection visualizer: [You] <— neon beam with flowing packets —> [Peer].
// Reflects the live connection state; a compact, prominent alternative to the
// inline PulseLine glyph, used on the Send/Receive connection cards.
import { SendIcon, ReceiveIcon } from "../icons";

export type BeamState = "waiting" | "connected" | "transferring" | "done";

const LABELS: Record<BeamState, string> = {
  waiting: "Waiting for the other device…",
  connected: "Connection established",
  transferring: "Transferring packets",
  done: "Transfer complete",
};

export function PeerBeam({ state }: { state: BeamState }) {
  return (
    <div className={`peerbeam ${state}`}>
      <div className="pb-row">
        <div className="pb-node">
          <span className="pb-dot">
            <SendIcon size={16} />
          </span>
          <span className="pb-label">You</span>
        </div>
        <div className="pb-beam">
          <span className="pb-packet" />
          <span className="pb-packet" />
          <span className="pb-packet" />
        </div>
        <div className="pb-node">
          <span className="pb-dot">
            <ReceiveIcon size={16} />
          </span>
          <span className="pb-label">Peer</span>
        </div>
      </div>
      <div className="pb-status">{LABELS[state]}</div>
    </div>
  );
}
