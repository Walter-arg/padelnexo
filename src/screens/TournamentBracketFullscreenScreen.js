import TournamentFixtureScreen from "./TournamentFixtureScreen";

export default function TournamentBracketFullscreenScreen({ navigation, route }) {
  return (
    <TournamentFixtureScreen
      navigation={navigation}
      route={{
        ...route,
        params: {
          ...(route?.params || {}),
          bracketFullscreenStandalone: true,
        },
      }}
    />
  );
}
