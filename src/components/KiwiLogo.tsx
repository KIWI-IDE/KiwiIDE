import iconUrl from "../../assets/branding/kiwi-logo-mark.png";
import wordmarkUrl from "../../assets/branding/kiwi-logo-wordmark-dark.png";

export function KiwiLogo({ size = 22, className = "" }: { size?: number; className?: string }) {
  const filterId = `kiwi-accent-${useId().replace(/:/g, "")}`;
  return (
    <svg className={`kiwi-logo-image ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feFlood className="kiwi-logo-accent" result="accent" />
          <feComposite in="accent" in2="SourceGraphic" operator="in" result="tint" />
          <feBlend in="tint" in2="SourceGraphic" mode="color" />
        </filter>
      </defs>
      <image href={iconUrl} width="100" height="100" filter={`url(#${filterId})`} />
    </svg>
  );
}

export function KiwiWordmark({ className = "" }: { className?: string }) {
  return <img className={`kiwi-wordmark-image ${className}`} src={wordmarkUrl} alt="Kiwi IDE" draggable={false} />;
}
import { useId } from "react";
