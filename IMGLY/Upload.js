// Upload.js
import React, { useEffect } from 'react';
import { View, Text, Platform } from 'react-native';
import IMGLYCamera from '@imgly/camera-react-native';
import RNFS from 'react-native-fs';

// Camera license
const CAMERA_LICENSE_KEY = 'wu-Dd1KirxkzpHKg-W96wtZk9y5rpvdCad0IxiRFvj-gyFLvDSv2JLjTney8GKv9';
const USER_ID = '1';

export default function Upload({ navigation }) {
  useEffect(() => {
    openCameraOnMount();
  }, []);

  const openCameraOnMount = async () => {
    try {
      console.log('[Upload] Opening camera (video=true)...');

      const cameraResult = await IMGLYCamera.openCamera({
        license: CAMERA_LICENSE_KEY,
        userID: USER_ID,
        video: true
      });

      console.log('[Upload] Camera result =>', cameraResult);

      if (!cameraResult) {
        console.log('[Upload] No camera result => user canceled or error');
        navigation.goBack();
        return;
      }

      // Extract final video URI
      let capturedUri = cameraResult.uri;
      if (!capturedUri && cameraResult.recordings?.length > 0) {
        const firstRecording = cameraResult.recordings[0];
        if (firstRecording.videos?.length > 0) {
          capturedUri = firstRecording.videos[0].uri;
        }
      }
      if (!capturedUri) {
        console.log('[Upload] No valid URI => user canceled or error');
        navigation.goBack();
        return;
      }
      console.log('[Upload] Raw captured URI =>', capturedUri);

      // iOS rename if missing .mp4
      let finalUri = capturedUri.replace('file:///private', 'file://');
      if (Platform.OS === 'ios' && !finalUri.endsWith('.mp4')) {
        const targetPath = `${RNFS.TemporaryDirectoryPath}/recorded_${Date.now()}.mp4`;
        console.log(`[Upload] Renaming iOS file => ${targetPath}`);
        try {
          await RNFS.moveFile(finalUri.replace('file://', ''), targetPath);
          finalUri = `file://${targetPath}`;
        } catch (renameErr) {
          console.log('[Upload] Error renaming =>', renameErr);
          finalUri = capturedUri;
        }
      }

      // Debug: check file size
      try {
        const stats = await RNFS.stat(finalUri.replace('file://', ''));
        console.log(`[Upload] Final video size => ${stats.size} bytes`);
      } catch (statErr) {
        console.log('[Upload] Could not stat final file =>', statErr);
      }

      console.log('[Upload] Final video URI =>', finalUri);

      // Navigate to PostDetails
      navigation.navigate('PostDetails', { mediaUri: finalUri });
    } catch (error) {
      console.log('[Upload] Error opening camera =>', error);
      navigation.goBack();
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Camera is opening...</Text>
    </View>
  );
}
