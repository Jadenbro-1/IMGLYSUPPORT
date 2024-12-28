// PostDetails.js
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import IMGLYEditor, {
  EditorSettingsModel,
  EditorPreset
} from '@imgly/editor-react-native';

const VIDEO_EDITOR_LICENSE_KEY = 'wu-Dd1KirxkzpHKg-W96wtZk9y5rpvdCad0IxiRFvj-gyFLvDSv2JLjTney8GKv9';
const USER_ID = '1';

export default function PostDetails({ route, navigation }) {
  const mediaUri = route.params?.mediaUri;

  useEffect(() => {
    if (mediaUri) {
      openVideoEditor(mediaUri);
    } else {
      console.log('[PostDetails] No mediaUri => goBack()');
      navigation.goBack();
    }
  }, [mediaUri]);

  const openVideoEditor = async (uri) => {
    console.log('[PostDetails] Opening default Editor =>', uri);
    try {
      // 1) Create minimal settings (No custom UI config)
      const settings = new EditorSettingsModel({
        license: VIDEO_EDITOR_LICENSE_KEY,
        userID: USER_ID,
        uri
      });

      // 2) Use VIDEO preset
      const preset = EditorPreset.VIDEO;

      // 3) Open the default editor with no custom bridging
      const result = await IMGLYEditor.openEditor(settings, undefined, preset);

      // 4) Check final result
      if (result?.artifact) {
        // Means user tapped “Done” or any default “export” in the advanced UI
        console.log('[Editor] artifact =>', result.artifact);
        navigation.navigate('PostUpload', {
          editedMedia: [{ uri: result.artifact }] // In older versions, the field might be result.uri
        });
      } else {
        // Means user canceled or tapped the default close
        console.log('[Editor] No artifact => user canceled => nav Home');
        navigation.navigate('Home');
      }
    } catch (err) {
      console.log('[PostDetails] Editor error =>', err);
      navigation.navigate('Home');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff' }}>Opening the video editor...</Text>
    </View>
  );
}
