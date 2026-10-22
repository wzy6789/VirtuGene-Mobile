import characterBackdrop from '../../assets/primary-scenes/mountain-lake.webp';
import personalBackdrop from '../../assets/primary-scenes/night-coast.webp';
import '../../styles/primary-page-scenes.css';

const backdrops = {
  characters: { src: characterBackdrop, width: 887, height: 1774 },
  me: { src: personalBackdrop, width: 887, height: 1774 },
} as const;

/** Static photography keeps the scene sharp while only the controls sample glass. */
export function PrimaryPageBackdrop({ page }: { page: keyof typeof backdrops }) {
  const image = backdrops[page];
  return <div className="vg-primary-page-backdrop" aria-hidden="true">
    <img src={image.src} width={image.width} height={image.height} alt="" decoding="async" />
  </div>;
}
