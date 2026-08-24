import * as SplashScreen from 'expo-splash-screen';
import { registerRootComponent } from 'expo';
import App from './App';

// Native splash ekranı JS hazır olana kadar açık kalsın (logo görünsün)
SplashScreen.preventAutoHideAsync();

registerRootComponent(App);
