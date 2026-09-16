// Только то, что нужно сцене на обложке (assets/js/hero-field.js).
// Полная сборка three.js 0.186 весит больше 2 МБ без сжатия,
// а эта вытягивает из неё рендерер и несколько классов.
// Пересборка после изменения списка: npm run build:three
export {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  Points,
  Color,
  Vector2,
  Vector3,
  NormalBlending,
  NoToneMapping,
  SRGBColorSpace,
} from 'three';
