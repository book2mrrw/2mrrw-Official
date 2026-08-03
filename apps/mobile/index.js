import 'expo-router/entry';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/audio/AudioEngine';

TrackPlayer.registerPlaybackService(() => PlaybackService);
