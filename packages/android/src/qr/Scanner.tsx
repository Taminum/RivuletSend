import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Camera} from 'react-native-camera-kit';
import {theme} from '../theme';

// Full-screen QR scanner. Requests the camera permission, then hands the first
// decoded string back via onScan. The caller pulls the room code out of it.
export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        setGranted(res === PermissionsAndroid.RESULTS.GRANTED);
      } catch {
        setGranted(false);
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
      {granted === null && <ActivityIndicator color={theme.accent} size="large" />}
      {granted === false && (
        <View style={styles.center}>
          <Text style={styles.msg}>Camera permission is needed to scan a QR code.</Text>
        </View>
      )}
      {granted === true && (
        <Camera
          style={StyleSheet.absoluteFill}
          cameraType={'back' as any}
          scanBarcode={true}
          onReadCode={(event: any) => {
            if (done) return;
            const value = event?.nativeEvent?.codeStringValue;
            if (value) {
              setDone(true);
              onScan(value);
            }
          }}
        />
      )}
      <TouchableOpacity style={styles.close} onPress={onClose}>
        <Text style={styles.closeText}>Close</Text>
      </TouchableOpacity>
      {granted === true && (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Point at the QR code on the other device</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  center: {padding: 30},
  msg: {color: theme.text, fontSize: 16, textAlign: 'center'},
  close: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  closeText: {color: '#fff', fontWeight: '700', fontSize: 15},
  hintWrap: {position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center'},
  hint: {color: '#fff', fontSize: 14, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8},
});
