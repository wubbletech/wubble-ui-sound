import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createNativeFeedbackClient } from "@wubbleai/react-native";
import { createExpoFeedbackBridge } from "@wubbleai/react-native/expo";
import manifest from "./wubble-manifest.json";

const assets = {
  "tap.mp3": require("./assets/tap.mp3"),
  "success.mp3": require("./assets/success.mp3")
};

export default function App() {
  const feedback = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void createExpoFeedbackBridge().then((bridge) => {
      feedback.current = createNativeFeedbackClient(manifest, {
        assets: (file) => assets[file],
        audio: bridge,
        haptics: bridge,
        enabled: true
      });
      if (active) setReady(true);
    });
    return () => {
      active = false;
      feedback.current?.stopAll();
    };
  }, []);

  return (
    <View>
      <Pressable disabled={!ready} onPress={() => void feedback.current?.tap()}><Text>Tap</Text></Pressable>
      <Pressable disabled={!ready} onPress={() => void feedback.current?.success()}><Text>Complete</Text></Pressable>
    </View>
  );
}
