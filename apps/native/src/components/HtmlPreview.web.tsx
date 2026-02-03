import { useState } from "react";
import { View } from "react-native";
import { colors, radius } from "@/theme";

/** Web version: the page in an iframe at its real width, scaled down to fit the screen. */
export function HtmlPreview({
  html,
  height = 640,
  pageWidth = 800,
}: {
  html: string;
  height?: number;
  pageWidth?: number;
}) {
  const [width, setWidth] = useState(0);
  const scale = width ? Math.min(1, width / pageWidth) : 1;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        height,
        overflow: "hidden",
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.canvas,
      }}
    >
      {width ? (
        <iframe
          title="Preview"
          srcDoc={html}
          style={{
            width: pageWidth,
            height: height / scale,
            border: 0,
            // The box is a flex column of fixed height; don't let it squeeze the page
            flexShrink: 0,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      ) : null}
    </View>
  );
}
