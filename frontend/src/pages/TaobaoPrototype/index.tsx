import { useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  BellOutlined,
  HeartOutlined,
  HomeOutlined,
  MenuOutlined,
  MessageOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Drawer, Input, Segmented, Space, Tag } from 'antd';
import './style.css';

type Product = {
  id: number;
  title: string;
  shop: string;
  price: number;
  sold: string;
  tag: string;
  swatch: string;
};

const categories = [
  '女装',
  '男装',
  '手机',
  '家电',
  '美妆',
  '运动',
  '食品',
  '家居',
  '母婴',
  '车品',
  '数码',
  '潮玩',
];

const products: Product[] = [
  { id: 1, title: '云感针织开衫女春秋薄款', shop: 'Tmall 风格馆', price: 129, sold: '2.4万+人付款', tag: '百亿补贴', swatch: 'coral' },
  { id: 2, title: '降噪蓝牙耳机长续航旗舰款', shop: '数码优选', price: 259, sold: '1.8万+人付款', tag: '官方直降', swatch: 'blue' },
  { id: 3, title: '轻奢陶瓷餐具套装家用', shop: '生活美学社', price: 89, sold: '9600+人付款', tag: '淘抢购', swatch: 'green' },
  { id: 4, title: '智能扫地机器人自动集尘', shop: '家电旗舰店', price: 1699, sold: '5300+人付款', tag: '以旧换新', swatch: 'silver' },
  { id: 5, title: '复古运动鞋男女同款', shop: '潮流运动', price: 319, sold: '3.1万+人付款', tag: '限时券', swatch: 'purple' },
  { id: 6, title: '玻尿酸保湿精华套装', shop: '美妆直营', price: 199, sold: '1.2万+人付款', tag: '买一赠一', swatch: 'pink' },
  { id: 7, title: '人体工学办公椅透气腰托', shop: '办公空间', price: 579, sold: '7400+人付款', tag: '企业采购', swatch: 'orange' },
  { id: 8, title: '轻量登机箱 20 寸万向轮', shop: '旅行实验室', price: 239, sold: '8800+人付款', tag: '新品', swatch: 'teal' },
];

const cartPreview = [
  { name: '云感针织开衫', qty: 1, price: 129 },
  { name: '蓝牙耳机旗舰款', qty: 1, price: 259 },
  { name: '陶瓷餐具套装', qty: 2, price: 178 },
];

function ProductVisual({ swatch }: { swatch: string }) {
  return (
    <div className={`tb-product-visual ${swatch}`}>
      <span />
      <i />
      <b />
    </div>
  );
}

export default function TaobaoPrototype() {
  const [query, setQuery] = useState('春季通勤穿搭');
  const [cartOpen, setCartOpen] = useState(false);
  const [mode, setMode] = useState<string | number>('推荐');
  const filteredProducts = useMemo(() => products, []);
  const cartTotal = cartPreview.reduce((sum, item) => sum + item.price, 0);

  return (
    <main className="tb-page">
      <header className="tb-topbar">
        <div className="tb-topbar-inner">
          <Space size={16} className="tb-location">
            <span>中国大陆</span>
            <span>亲，请登录</span>
            <strong>免费注册</strong>
          </Space>
          <Space size={18} className="tb-quicklinks">
            <span>我的淘宝</span>
            <span>收藏夹</span>
            <span>卖家中心</span>
            <span>联系客服</span>
          </Space>
        </div>
      </header>

      <section className="tb-shell">
        <nav className="tb-nav">
          <a className="active"><HomeOutlined /> 首页</a>
          <a><AppstoreOutlined /> 天猫</a>
          <a>聚划算</a>
          <a>淘宝直播</a>
          <a>闲鱼</a>
        </nav>

        <section className="tb-search-section">
          <div className="tb-logo">
            <span>淘</span>
            <strong>淘宝原型</strong>
          </div>
          <div className="tb-search-card">
            <Segmented
              size="small"
              value={mode}
              onChange={setMode}
              options={['推荐', '宝贝', '店铺', '内容']}
              className="tb-search-tabs"
            />
            <Input
              size="large"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              prefix={<SearchOutlined />}
              suffix={<Button type="primary">搜索</Button>}
            />
            <div className="tb-hotwords">
              {['冲锋衣', '空气炸锅', '小白鞋', '宠物粮', '机械键盘', '收纳箱'].map((word) => (
                <button key={word} onClick={() => setQuery(word)}>{word}</button>
              ))}
            </div>
          </div>
          <Button
            className="tb-cart-button"
            size="large"
            icon={<ShoppingCartOutlined />}
            onClick={() => setCartOpen(true)}
          >
            <Badge count={4} offset={[8, -6]}>购物车</Badge>
          </Button>
        </section>

        <section className="tb-main-grid">
          <aside className="tb-category-panel">
            <div className="tb-panel-title"><MenuOutlined /> 主题市场</div>
            <div className="tb-category-list">
              {categories.map((category) => (
                <button key={category}>{category}<span>精选</span></button>
              ))}
            </div>
          </aside>

          <section className="tb-hero">
            <div className="tb-hero-copy">
              <Tag color="orange">618 理想生活季</Tag>
              <h1>每天都有新惊喜</h1>
              <p>首页、搜索、类目、商品流与购物车侧栏的高保真电商原型。</p>
              <Space>
                <Button type="primary" size="large">立即逛逛</Button>
                <Button size="large">查看会场</Button>
              </Space>
            </div>
            <div className="tb-hero-stage" aria-hidden="true">
              <div className="tb-package tall" />
              <div className="tb-package round" />
              <div className="tb-package small" />
            </div>
          </section>

          <aside className="tb-user-panel">
            <div className="tb-avatar"><UserOutlined /></div>
            <strong>Hi，欢迎来到淘宝</strong>
            <Space>
              <Button type="primary">登录</Button>
              <Button>注册</Button>
            </Space>
            <div className="tb-user-stats">
              <span><b>8</b> 待收货</span>
              <span><b>12</b> 收藏</span>
              <span><b>3</b> 优惠券</span>
            </div>
          </aside>
        </section>

        <section className="tb-promo-row">
          {[
            ['限时秒杀', '整点开抢', '¥9.9 起'],
            ['天猫超市', '次日达', '满 88 包邮'],
            ['淘宝直播', '边看边买', '爆款讲解'],
            ['品牌会员', '入会好礼', '专属价'],
          ].map(([title, desc, meta]) => (
            <article className="tb-promo-card" key={title}>
              <span>{title}</span>
              <strong>{desc}</strong>
              <em>{meta}</em>
            </article>
          ))}
        </section>

        <section className="tb-feed-head">
          <div>
            <h2>猜你喜欢</h2>
            <p>基于当前搜索意图和频道偏好推荐</p>
          </div>
          <Space>
            <Button icon={<StarOutlined />}>精选</Button>
            <Button icon={<HeartOutlined />}>收藏</Button>
          </Space>
        </section>

        <section className="tb-product-grid">
          {filteredProducts.map((product) => (
            <article className="tb-product-card" key={product.id}>
              <ProductVisual swatch={product.swatch} />
              <div className="tb-product-info">
                <Tag>{product.tag}</Tag>
                <h3>{product.title}</h3>
                <p>{product.shop}</p>
                <div className="tb-product-bottom">
                  <strong>¥{product.price}</strong>
                  <span>{product.sold}</span>
                </div>
              </div>
            </article>
          ))}
        </section>
      </section>

      <div className="tb-floating-rail">
        <button><MessageOutlined /><span>消息</span></button>
        <button><BellOutlined /><span>通知</span></button>
        <button onClick={() => setCartOpen(true)}><ShoppingCartOutlined /><span>购物车</span></button>
      </div>

      <Drawer
        title="购物车预览"
        width={380}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        className="tb-cart-drawer"
      >
        <div className="tb-cart-list">
          {cartPreview.map((item) => (
            <div className="tb-cart-line" key={item.name}>
              <span>{item.name}</span>
              <em>x{item.qty}</em>
              <strong>¥{item.price}</strong>
            </div>
          ))}
        </div>
        <div className="tb-cart-summary">
          <span>合计</span>
          <strong>¥{cartTotal}</strong>
        </div>
        <Button type="primary" size="large" block>去结算</Button>
      </Drawer>
    </main>
  );
}
