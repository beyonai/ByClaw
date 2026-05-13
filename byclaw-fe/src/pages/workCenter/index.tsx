/* eslint-disable max-len */
import CommonTabs from '@/components/CommonTabs';
import { CaretRightOutlined, CloseOutlined, FileTextOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { TabsProps } from 'antd';
import { Empty, Input, Space, message } from 'antd';
import React, { useState } from 'react';
import ArticleDetail from './components/ArticleDetail';
import styles from './index.module.less';

const workList = [
  {
    id: 1,
    type: 'video',
    title: 'AI 无处不在：从生活到工作的变革',
    description: '',
    src: 'https://gw.alipayobjects.com/zos/rmsportal/mqaQswcyDLcXyDKnZfES.png',
  },
  {
    id: 2,
    type: 'article',
    title: '中国社科院都阳：中国人口转变的独特性及其影响',
    description:
      '近期，省市督查组以群众反映的问题线索为主要抓手，采取"四不两直"的方式针对各地暑期违规组织补课情况进行核查。汇文中学无视相关工作要求，于暑期组织初二年级学生在校内开展违规补课，未全面落实"双减"政策，损害学生身心健康，造成恶劣影响。近期，省市督查组以群众反映的问题线索为主要抓手，采取"四不两直"的方式针对各地暑期违规组织补课情况进行核查。汇文中学无视相关工作要求，于暑期组织初二年级学生在校内开展违规补课，未全面落实"双减"政策，损害学生身心健康，造成恶劣影响。近期，省市督查组以群众反映的问题线索为主要抓手，采取"四不两直"的方式针对各地暑期违规组织补课情况进行核查。汇文中学无视相关工作要求，于暑期组织初二年级学生在校内开展违规补课，未全面落实"双减"政策，损害学生身心健康，造成恶劣影响。近期，省市督查组以群众反映的问题线索为主要抓手，采取"四不两直"的方式针对各地暑期违规组织补课情况进行核查。汇文中学无视相关工作要求，于暑期组织初二年级学生在校内开展违规补课，未全面落实"双减"政策，损害学生身心健康，造成恶劣影响。',
  },
  {
    id: 4,
    type: 'article',
    title: '无人机全程拍摄！时隔三十多年再探切尔诺贝利核电站 如今变成什么样',
    description:
      '清晨，阳光还未完全照进房间，智能音箱里传来轻柔的音乐，将你从睡梦中唤醒。你对着它简单吩咐一句，窗帘便缓缓拉开，房间里逐渐明亮起来。准备出门上班时，手机导航根据实时路况为你规划最优路线，避开拥堵路段，让你节省通勤时间。回到家中，智能家居系统根据你的习惯自动调节室内温度、灯光亮度，还能实时监测室内空气质量，为你营造一个舒适的居住环境。这些看似普通的场景，背后都离不开人工智能技术的支持 。智能家居设备通过传感器收集数据，利用机器学习算法分析用户习惯，从而实现智能化的自动控制。而语音助手则借助自然语言处理技术，理解你的指令并做出相应的回应，让生活变得更加便捷。在工作领域，AI 的影响力同样不容小觑。许多办公软件如今都融入了 AI 功能，实现了自动化任务处理、智能推荐和数据分析等功能。以邮件处理为例，AI 可以自动对邮件进行分类，将重要邮件优先展示，还能根据过往的回复习惯，为你快速生成回复内容，大大提高了办公效率。在内容创作方面，AI 更是展现出了强大的实力。无论是撰写新闻稿件、文案策划，还是创作诗歌、小说，AI 都能在短时间内生成高质量的内容。一些媒体机构已经开始使用 AI 撰写体育赛事、财经新闻等简短报道，不仅速度快，而且准确性高。在设计领域，AI 可以根据用户输入的关键词和需求，快速生成海报、插画等设计作品，为设计师提供灵感和创意。',
  },
  {
    id: 3,
    type: 'video',
    title: '长租公寓的风险应留意, 具体原因为哪般?',
    description: '',
    src: 'https://gw.alipayobjects.com/zos/rmsportal/mqaQswcyDLcXyDKnZfES.png',
  },
  {
    id: 5,
    type: 'video',
    title: '暑期游火爆，文旅企业收入却"令人意外"在下降？',
    description: '',
    src: 'https://gw.alipayobjects.com/zos/rmsportal/mqaQswcyDLcXyDKnZfES.png',
  },
  {
    id: 6,
    type: 'article',
    title: '10万吨级的"海上粮仓"，到底有多厉害？',
    description:
      '近期，多地高温持续，空调负荷不断增加，为了应对高温，全国多个城市开始探索"区域集中供冷"。什么是集中供冷？效果怎么样？入伏后，广州高温预警持续，正值暑期客流高峰的广州图书馆，每天要接待几万名读者。为了保持凉爽，这里的一百多个出风口从9时到21时持续运转，这样大量持续的供冷，并不是由一台台空调，而是由冷冻水管来完成。一到假期，大量"xx暑假最可怕"的视频、文章就占领各大社交媒体平台。本是无忧无虑的快乐暑假，怎么就可怕了？配上氛围紧张的背景音乐，一些所谓"资深人士"在短视频、营销号里"情真意切"地提醒家长，"暑假不规划，开学差距大""不怕同学是学霸，就怕学霸过暑假"……视频下方的链接里显示，相关资料、课程已售出上万套。近期，多地高温持续，空调负荷不断增加，为了应对高温，全国多个城市开始探索"区域集中供冷"。什么是集中供冷？效果怎么样？入伏后，广州高温预警持续，正值暑期客流高峰的广州图书馆，每天要接待几万名读者。为了保持凉爽，这里的一百多个出风口从9时到21时持续运转，这样大量持续的供冷，并不是由一台台空调，而是由冷冻水管来完成。一到假期，大量"xx暑假最可怕"的视频、文章就占领各大社交媒体平台。本是无忧无虑的快乐暑假，怎么就可怕了？配上氛围紧张的背景音乐，一些所谓"资深人士"在短视频、营销号里"情真意切"地提醒家长，"暑假不规划，开学差距大""不怕同学是学霸，就怕学霸过暑假"……视频下方的链接里显示，相关资料、课程已售出上万套。',
  },
  {
    id: 8,
    type: 'article',
    title: '最后一公里的阴影：他们为什么纷纷逃离末端驿站',
    description:
      '每次宏观经济运行出现困难时刻，特别是总需求不足时，总会有两派观点：一派认为当前的政策重心应该是总需求的平衡，想办法扩大总需求，恢复总量平衡；另一派认为应该深化改革，通过结构性改革措施，既解决短期问题，也为长期更强劲的增长奠定基础。在工作领域，AI 的影响力同样不容小觑。许多办公软件如今都融入了 AI 功能，实现了自动化任务处理、智能推荐和数据分析等功能。以邮件处理为例，AI 可以自动对邮件进行分类，将重要邮件优先展示，还能根据过往的回复习惯，为你快速生成回复内容，大大提高了办公效率。在内容创作方面，AI 更是展现出了强大的实力。无论是撰写新闻稿件、文案策划，还是创作诗歌、小说，AI 都能在短时间内生成高质量的内容。一些媒体机构已经开始使用 AI 撰写体育赛事、财经新闻等简短报道，不仅速度快，而且准确性高。在设计领域，AI 可以根据用户输入的关键词和需求，快速生成海报、插画等设计作品，为设计师提供灵感和创意。在工作领域，AI 的影响力同样不容小觑。许多办公软件如今都融入了 AI 功能，实现了自动化任务处理、智能推荐和数据分析等功能。以邮件处理为例，AI 可以自动对邮件进行分类，将重要邮件优先展示，还能根据过往的回复习惯，为你快速生成回复内容，大大提高了办公效率。在内容创作方面，AI 更是展现出了强大的实力。无论是撰写新闻稿件、文案策划，还是创作诗歌、小说，AI 都能在短时间内生成高质量的内容。一些媒体机构已经开始使用 AI 撰写体育赛事、财经新闻等简短报道，不仅速度快，而且准确性高。在设计领域，AI 可以根据用户输入的关键词和需求，快速生成海报、插画等设计作品，为设计师提供灵感和创意。',
  },
  {
    id: 7,
    type: 'video',
    title: '曾比恒大冲更猛，他比许家印更可惜',
    description: '',
    src: 'https://gw.alipayobjects.com/zos/rmsportal/mqaQswcyDLcXyDKnZfES.png',
  },
];

const collectList = [
  {
    id: 1,
    type: 'article',
    title: '外观惊艳、信号改善！你理想中的 iPhone，已在路上',
    description:
      '在接受调查的19为华尔街分析师中，看涨和看平下周金价走势的各有8人，占比42%，看空金价的有三人，占比16%。与此同时，在接受网上调查的369名普通投资者中，有221人（60%）预计下周金价将上涨，有95人（26%）料走软，53人（14%）持中立态度。这些投资者预计金价将在下周末前重新测试1980美元左右的阻力位。',
  },
  {
    id: 2,
    type: 'article',
    title: '从大众到冷门，这些 APP 经历了什么',
    description:
      '7月25日，来自北京朝阳区的张女士向潇湘晨报晨意帮忙记者反映，她带着母亲报名参加了云南乐逍遥旅行社有限公司的6天5晚的旅游团，遭遇强制购物。当她向旅行社客服反映时，却收到了上述回复。',
  },
  {
    id: 3,
    type: 'article',
    title: '闽人智慧丨土楼不土，尽显科学与艺术之美',
    description:
      '每次宏观经济运行出现困难时刻，特别是总需求不足时，总会有两派观点：一派认为当前的政策重心应该是总需求的平衡，想办法扩大总需求，恢复总量平衡；另一派认为应该深化改革，通过结构性改革措施，既解决短期问题，也为长期更强劲的增长奠定基础。',
    src: '',
  },
  {
    id: 4,
    type: 'article',
    title: '纽约时报 | 没有中国，世界还能造动力电池吗',
    description:
      '近日，一则"电线杆建在农田里"的消息引发热议。据媒体报道，有群众不断反映，南方电网广东湛江供电局在建设输电工程时，事先未经村民同意就动工修建，而且还占用了部分水稻田，影响农民种田，引发农民不满。',
    src: '',
  },
  {
    id: 5,
    type: 'article',
    title: '中国社科院都阳：中国人口转变的独特性及其影响',
    description:
      '消息一出，瞬间引爆互联网，分分钟登顶Hacker News。假如这次发现为真，那么我们就能实现无损的能量传输，全球的能耗问题将从源头上解决，人类能利用电能获得巨大的力量。',
    src: '',
  },
  {
    id: 6,
    type: 'article',
    title: '长租公寓的风险应留意',
    description:
      '舳舻千里，旌旗蔽空，酾酒临江，横槊赋诗……在古代，水上航运是常用的交通方式。时光划过千百年，打通"黄金水道"复兴水上交通，成为时代的新命题。',
    src: '',
  },
  {
    id: 7,
    type: 'article',
    title: '女子去银行取15万现金，工作人员细查后报警，民警顺线抓洗钱团伙',
    description:
      '舳舻千里，旌旗蔽空，酾酒临江，横槊赋诗……在古代，水上航运是常用的交通方式。时光划过千百年，打通"黄金水道"复兴水上交通，成为时代的新命题。',
    src: '',
  },
  {
    id: 8,
    type: 'article',
    title: '中国正能量，为奋进的中国吹响号角',
    description:
      '在接受调查的19为华尔街分析师中，看涨和看平下周金价走势的各有8人，占比42%，看空金价的有三人，占比16%。与此同时，在接受网上调查的369名普通投资者中，有221人（60%）预计下周金价将上涨，有95人（26%）料走软，53人（14%）持中立态度。这些投资者预计金价将在下周末前重新测试1980美元左右的阻力位。',
    src: '',
  },
  {
    id: 9,
    type: 'article',
    title: '经济学家高善文：25-59岁人口失业率创新低 简单讨论失业率非常不完整',
    description:
      '不知道有多少小伙伴跟果子一样，APP 一旦装上了手机，用过几次，就很少把它们卸掉，即便使用频率很低，但也会想着万一到时候能用上呢？',
    src: '',
  },
  {
    id: 10,
    type: 'article',
    title: '41℃高温下，被抢爆的藿香正气背后！',
    description:
      '夏粮丰，全年稳。国家粮食和物资储备局25日数据显示，截至目前统计，主产区各类粮食企业累计收购小麦超3800万吨，完成预计旺季收购量的六成左右。主要用作口粮的小麦，直接关系到中国饭碗端得稳不稳。收购进展如何？市场价格怎么样？部分主产区"烂场雨"影响多大？针对大家关心的话题，记者采访了有关部门和粮油企业。',
    src: '',
  },
  {
    id: 11,
    type: 'article',
    title: '论坛论道丨肖钢：大力发展数字经济',
    description:
      '驷马河国家湿地公园位于驷马省级自然保护区内，主要包括驷马河、高坑河、徐家河、花溪河及周边湿地区域，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，是嘉陵江上游保存较为完好的自然河流生态系统，也是川东北山地向丘陵过渡地带"河流-森林"复合湿地生态系统的典型代表，保护着长江上游中小河流源头地区的珍贵特有鱼类种质资源。',
    src: '',
  },
  {
    id: 12,
    type: 'article',
    title: '大力发展数字经济',
    description:
      '驷马河国家湿地公园位于驷马省级自然保护区内，主要包括驷马河、高坑河、徐家河、花溪河及周边湿地区域，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，是嘉陵江上游保存较为完好的自然河流生态系统，也是川东北山地向丘陵过渡地带"河流-森林"复合湿地生态系统的典型代表，保护着长江上游中小河流源头地区的珍贵特有鱼类种质资源。',
    src: '',
  },
  {
    id: 13,
    type: 'article',
    title: '肖钢：大力发展数字经济',
    description:
      '南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，驷马河国家湿地公园位于驷马省级自然保护区内，主要包括驷马河、高坑河、徐家河、花溪河及周边湿地区域，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，是嘉陵江上游保存较为完好的自然河流生态系统，也是川东北山地向丘陵过渡地带"河流-森林"复合湿地生态系统的典型代表，保护着长江上游中小河流源头地区的珍贵特有鱼类种质资源。',
    src: '',
  },
  {
    id: 14,
    type: 'article',
    title: '论坛论道丨大力发展数字经济',
    description:
      '驷马河国家湿地公园位于驷马省级自然保护区内，主要包括驷马河、高坑河、徐家河、花溪河及周边湿地区域，南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，是嘉陵江上游保存较为完好的自然河流生态系统，也是川东北山地向丘陵过渡地带"河流-森林"复合湿地生态系统的典型代表，保护着长江上游中小河流源头地区的珍贵特有鱼类种质资源。南北跨度18.45千米，总面积372.98公顷，其中湿地面积155.78公顷，湿地率41.77 %，',
    src: '',
  },
].slice(0, 105);

export interface FileItem {
  id: string;
  fileName: string;
  type: string;
  icon: string;
  modifiedTime: string;
}

const WorkCenter: React.FC = () => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState('work');
  const [activeButton, setActiveButton] = useState('');
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showArticleDetail, setShowArticleDetail] = useState(false);

  const [selectedArticle] = useState<any>(null);

  const controls = true;

  const items: TabsProps['items'] = [
    {
      key: 'work',
      label: intl.formatMessage({ id: 'workCenter.work' }),
    },
    {
      key: 'collect',
      label: intl.formatMessage({ id: 'workCenter.collect' }),
    },
  ];

  const handleViewArticle = (item: any) => {
    if (item.type === 'video') {
      setShowVideoModal(true);
    } else {
    }
  };

  const renderContent = (items: any) =>
    items.length ? (
      <div className={styles.grid}>
        <div className={styles.gridContainer}>
          {items.map((item: any, index: number) => (
            <div key={index} className={styles.gridItem}>
              {item.type === 'video' && (
                <video
                  className={styles.video}
                  ref={() => {}}
                  src={item.src}
                  poster={
                    // eslint-disable-next-line max-len
                    'https://image.baidu.com/search/detail?z=0&word=%E4%BA%BA%E7%89%A9%E8%A7%86%E9%A2%91%E9%A2%84%E8%A7%88%E5%9B%BE%E7%89%87&hs=0&pn=27&spn=0&di=7482437761027276801&pi=0&rn=1&tn=baiduimagedetail&is=0%2C0&ie=utf-8&oe=utf-8&lm=&cs=880738034%2C154841750&os=3200902912%2C267657752&simid=880738034%2C154841750&adpicid=0&lpn=0&fr=click-pic&fm=&ic=&hd=&latest=&copyright=&isImgSet=&commodity=&hot=&imgratio=&imgformat=&sme=&width=0&height=0&cg=&bdtype=0&oriquery=&objurl=https%3A%2F%2Fi-blog.csdnimg.cn%2Fblog_migrate%2Faf6282b35819a204ea0e3f60b32b8981.png&fromurl=ippr_z2C%24qAzdH3FAzdH3Fks52_z%26e3Bvf1g_z%26e3BgjpAzdH3Fkwt17_dl0a8aanAzdH3Fw6ptvsjAzdH3F1jpwtsfAzdH3F8namd09cl&gsm=1e&islist=&querylist=&lid=10589158393009248105'
                  }
                  controls={controls}
                >
                  <track default kind="captions" src="/media/examples/friday.vtt" />
                  {intl.formatMessage({
                    id: 'video.browserNotSupported',
                    defaultMessage: '您的浏览器暂不支持播放该视频，请升级版本',
                  })}
                </video>
              )}
              <p className={styles.title}>{item.title}</p>
              {item.type !== 'video' && (
                <p
                  className={styles.description}
                  style={{
                    maxHeight: activeTab === 'work' ? 245 : 157,
                  }}
                >
                  {item.description}
                </p>
              )}
              <div
                onMouseEnter={() => {
                  setActiveButton(item.id);
                }}
                onMouseLeave={() => {
                  setActiveButton('');
                }}
              >
                {item.id === activeButton ? (
                  <div className={styles.operateActive}>
                    <Space>
                      {item.type === 'video' ? (
                        <CaretRightOutlined className={styles.iconVideo} onClick={() => handleViewArticle(item)} />
                      ) : (
                        <FileTextOutlined className={styles.iconVideo} />
                      )}
                      <span onClick={() => handleViewArticle(item)}>{intl.formatMessage({ id: 'common.view' })}</span>
                      {item.type === 'video' && (
                        <span
                          onClick={() => {
                            message.info(
                              intl.formatMessage({
                                id: 'workCenter.featureComingSoon',
                              })
                            );
                          }}
                        >
                          {intl.formatMessage({ id: 'workCenter.makeVideo' })}
                        </span>
                      )}
                    </Space>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <Empty
        image="https://gw.alipayobjects.com/zos/antfincdn/ZHrcdLPrvN/empty.svg"
        imageStyle={{ height: 80 }}
        description={<span className={styles.noContent}>{intl.formatMessage({ id: 'workCenter.noContent' })}</span>}
      />
    );

  return (
    <div className={styles.workCenter}>
      <div className="ub ub-pj ub-ac">
        <div>
          <CommonTabs
            items={items}
            onChange={(activeKey) => {
              setActiveTab(activeKey);
            }}
          />
        </div>
        <div>
          <Input
            allowClear
            placeholder={intl.formatMessage({
              id: 'workCenter.searchPlaceholder',
            })}
            suffix={<SearchOutlined className={styles.searchWork} />}
          />
        </div>
      </div>
      {activeTab === 'work' && renderContent(workList)}
      {activeTab === 'collect' && renderContent(collectList)}

      {showVideoModal && (
        <div className={styles.videoModal}>
          <div className={styles.videoModalContent}>
            <video autoPlay controls src="https://www.w3schools.com/html/mov_bbb.mp4">
              {intl.formatMessage({
                id: 'video.browserNotSupported',
                defaultMessage: '您的浏览器暂不支持播放该视频，请升级版本',
              })}
              <track kind="captions" />
            </video>
            <div className={styles.videoModalClose} onClick={() => setShowVideoModal(false)}>
              <CloseOutlined className={styles.iconClose} />
            </div>
          </div>
        </div>
      )}

      <ArticleDetail open={showArticleDetail} onClose={() => setShowArticleDetail(false)} article={selectedArticle} />
    </div>
  );
};

export default WorkCenter;
