import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useTheme } from '../ui/theme';

export default function NotFound() {
  const t = useTheme();
  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Stack.Screen options={{ title: 'Niet gevonden' }} />
      <Text style={{ color: t.text, fontSize: 16 }}>Deze pagina bestaat niet.</Text>
      <Link href="/" style={{ color: t.accent, fontWeight: '700' }}>
        Naar het overzicht
      </Link>
    </View>
  );
}
