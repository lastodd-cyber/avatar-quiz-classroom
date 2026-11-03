function integer(value, fallback, name, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 설정값을 확인해 주세요.`);
  }
  return parsed;
}

export function readConfig(env = process.env) {
  if (env.CLOUD_MODE && !['0', '1'].includes(env.CLOUD_MODE)) {
    throw new Error('CLOUD_MODE는 0 또는 1이어야 합니다.');
  }
  const cloudMode = Boolean(env.K_SERVICE) || env.CLOUD_MODE === '1';
  const teacherKey = env.TEACHER_KEY || '';
  if (cloudMode && (teacherKey.length < 20 || Buffer.byteLength(teacherKey) > 256)) {
    throw new Error('클라우드 TEACHER_KEY는 20자 이상, UTF-8 256바이트 이하여야 합니다.');
  }
  const photoAssets = env.PHOTO_ASSETS || 'on';
  if (!['on', 'off'].includes(photoAssets)) throw new Error('PHOTO_ASSETS는 on 또는 off여야 합니다.');
  let publicUrl = '';
  // Render는 공개 주소를 RENDER_EXTERNAL_URL로 알려 준다. 직접 넣은 PUBLIC_URL이 우선.
  const publicUrlText = env.PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  if (publicUrlText) {
    const url = new URL(publicUrlText);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('PUBLIC_URL은 인증정보 없는 HTTP(S) 주소여야 합니다.');
    }
    if (cloudMode && url.protocol !== 'https:') throw new Error('클라우드 PUBLIC_URL은 HTTPS여야 합니다.');
    publicUrl = url.origin;
  }
  const config = {
    cloudMode,
    port: integer(env.PORT, cloudMode ? 8080 : 3210, 'PORT', 1, 65535),
    publicUrl,
    maxRooms: integer(env.MAX_ROOMS, cloudMode ? 3 : 10, 'MAX_ROOMS'),
    assetBytesPerHour: integer(env.ASSET_BYTES_PER_HOUR, cloudMode ? 4 * 1024 ** 3 : Infinity,
      'ASSET_BYTES_PER_HOUR', 0),
    photoAssets: photoAssets === 'on'
  };
  // 설정 전체를 실수로 로그에 찍어도 키가 노출되지 않게 한다.
  Object.defineProperty(config, 'teacherKey', { value: teacherKey, enumerable: false });
  return Object.freeze(config);
}
