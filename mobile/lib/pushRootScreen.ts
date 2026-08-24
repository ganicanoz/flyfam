import { StackActions, type NavigationProp, type ParamListBase } from '@react-navigation/native';

/**
 * Tab ekranından root native stack’e güvenli push (navigate yerine).
 * Cihazda nested history / canGoBack sorunlarını azaltır.
 */
export function pushRootScreen(
  navigation: NavigationProp<ParamListBase>,
  name: string,
  params?: object,
) {
  let nav: NavigationProp<ParamListBase> | undefined = navigation;
  while (nav) {
    const state = nav.getState?.();
    const names = state?.routeNames as string[] | undefined;
    if (names?.includes(name)) {
      nav.dispatch(StackActions.push(name, params));
      return;
    }
    nav = nav.getParent?.() as NavigationProp<ParamListBase> | undefined;
  }
  navigation.navigate(name as never, params as never);
}
