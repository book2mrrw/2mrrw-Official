import { Ionicons } from '@expo/vector-icons';

interface Props {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}

export function TabBarIcon({ name, color }: Props) {
  return <Ionicons name={name} size={24} color={color} />;
}
