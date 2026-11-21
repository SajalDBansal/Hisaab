/** Account access must remain available before the first firm is selected. */
export function availableWithoutFirm(path: readonly string[]) {
  return (
    path[0] === "firms" ||
    (path[0] === "settings" && ["account", "pin"].includes(path[1] ?? ""))
  );
}
