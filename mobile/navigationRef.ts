import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  CompleteProfile: undefined;
  Main: undefined;
  AddFlight:
    | {
        prefillFlightNumber?: string;
        sharedPdfUri?: string;
        /** Standby → uçuş: varsayılan tarih (YYYY-MM-DD). */
        prefillFlightDate?: string;
        /** Kaydetme sonrası silinecek nöbet satırı. */
        replaceStandbyFlightId?: string;
      }
    | undefined;
  EditFlight: { flightId: string; readOnly?: boolean } | undefined;
  AdminFlightApiDebug: { flightId: string } | undefined;
  AdminPanel: undefined;
  ConsentHistory: undefined;
  EditProfile: undefined;
  Connect: undefined;
  Plans: undefined;
  PrivacyNotice: undefined;
  TermsDisclaimer: undefined;
  Consent: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
