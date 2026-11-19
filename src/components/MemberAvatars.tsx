import { Avatar } from './ui/Avatar';
import type { MemberWithProfile } from '../types';
import { roleLabel } from '../lib/permissions';

interface MemberAvatarsProps {
  members: MemberWithProfile[];
  online?: string[];
  max?: number;
  onOpen?: () => void;
}

export function MemberAvatars({ members, online = [], max = 4, onOpen }: MemberAvatarsProps) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="btn min-h-9 gap-1 rounded-full px-2 py-1"
      aria-label={`${members.length} members — open member list`}
      title={members.map((m) => `${m.profile.display_name} (${roleLabel(m.role)})`).join('\n')}
    >
      <span className="flex -space-x-2">
        {shown.map((member) => (
          <span key={member.id} className="relative">
            <Avatar name={member.profile.display_name} url={member.profile.avatar_url} size={26} />
            {online.includes(member.user_id) ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-mint"
                aria-label="online"
              />
            ) : null}
          </span>
        ))}
      </span>
      {extra > 0 ? <span className="text-xs font-black">+{extra}</span> : null}
    </button>
  );
}
