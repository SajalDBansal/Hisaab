/* global module */
module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PROJECT_ID || config.extra?.eas?.projectId;
  const owner = process.env.EXPO_OWNER || config.owner;
  const slug = process.env.EXPO_SLUG || config.slug;
  const releasing = ["production", "direct"].includes(
    process.env.EAS_BUILD_PROFILE,
  );
  if (releasing && (!projectId || !owner)) {
    throw new Error("Release builds require EXPO_PROJECT_ID and EXPO_OWNER.");
  }
  if (
    releasing &&
    (process.env.EXPO_PUBLIC_API_URL !==
      "https://api.hisaab.sajaldbansal.com" ||
      process.env.EXPO_PUBLIC_REQUIRE_LOGIN !== "true")
  ) {
    throw new Error(
      "Release builds require the approved API and login enabled.",
    );
  }
  if (
    process.env.EAS_BUILD_PROFILE === "direct" &&
    process.env.EAS_BUILD_PLATFORM === "ios"
  ) {
    throw new Error(
      "The direct profile is Android only. Use production for iOS.",
    );
  }
  return {
    ...config,
    ...(owner ? { owner } : {}),
    slug,
    ...(projectId
      ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } }
      : {}),
  };
};
