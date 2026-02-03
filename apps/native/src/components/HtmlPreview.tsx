import { WebView } from "react-native-webview";
import { colors, radius } from "@/theme";

/**
 * Shows printable HTML (an invoice) inside the screen, scaled to fit the phone.
 * The page sets its own width (viewport meta), so the WebView zooms it out like a PDF viewer.
 * Web uses HtmlPreview.web.tsx.
 */
export function HtmlPreview({
  html,
  height = 640,
}: {
  html: string;
  height?: number;
  /** Width the page is laid out at (used by the web version). */
  pageWidth?: number;
}) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      style={{
        height,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.canvas,
      }}
      scalesPageToFit
      setBuiltInZoomControls={false}
      nestedScrollEnabled
    />
  );
}
