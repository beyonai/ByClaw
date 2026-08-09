import { getRuntimeActualUrl } from '@/utils';

export const SKILL_GROUP_DEFAULT_COVER_PATH = 'assets/skill-groups/default-skill-group-cover-3x4.png';

// 默认封面放在 public 目录下，需要按运行时 publicPath 拼接前缀
export const getSkillGroupDefaultCover = () => getRuntimeActualUrl(SKILL_GROUP_DEFAULT_COVER_PATH);
