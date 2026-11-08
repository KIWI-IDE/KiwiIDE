import iconUrl from "../../assets/branding/kiwi-logo-mark.png";
import wordmarkUrl from "../../assets/branding/kiwi-logo-wordmark-dark.png";

export function KiwiLogo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return <img className={`kiwi-logo-image ${className}`} src={iconUrl} width={size} height={size} alt="" draggable={false} />;
}

export function KiwiWordmark({ className = "" }: { className?: string }) {
  return <img className={`kiwi-wordmark-image ${className}`} src={wordmarkUrl} alt="Kiwi IDE" draggable={false} />;
}
