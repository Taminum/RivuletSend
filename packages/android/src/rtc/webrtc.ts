// Single import site for react-native-webrtc's WebRTC primitives. Keeping the
// library import in one place is deliberate: this is the platform seam the
// Android plan flags for verification (RTCDataChannel backpressure behavior has
// differed from the browser across versions), so everything that touches the
// native WebRTC surface goes through here.
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from 'react-native-webrtc';

export {RTCPeerConnection, RTCIceCandidate, RTCSessionDescription};

// react-native-webrtc's data channel is obtained from pc.createDataChannel /
// the 'datachannel' event, never constructed directly. Its runtime shape mirrors
// the browser's (send, bufferedAmount, bufferedAmountLowThreshold, the
// 'bufferedamountlow' event) — which is exactly what the probe verifies.
export type RNDataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
