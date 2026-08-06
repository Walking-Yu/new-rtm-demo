import { Headphones } from 'lucide-react';

export function HeadphonesWarning() {
  return (
    <div className="headphones-warning" role="note">
      <Headphones aria-hidden="true" size={20} />
      <div>
        <strong>请佩戴耳机</strong>
        <span>两个真实 RTC 客户端会同时播放远端音频，外放可能产生啸叫。</span>
      </div>
    </div>
  );
}
