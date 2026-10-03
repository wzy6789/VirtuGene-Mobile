import { SecretarySetupModal } from './SecretarySetupModal';

export function OnboardingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SecretarySetupModal open={open} onClose={onClose} welcome />;
}
