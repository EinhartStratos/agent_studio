import { createRouter, createWebHashHistory } from 'vue-router';
import ChatView from '../components/ChatView.vue';
import MarketplaceView from '../components/MarketplaceView.vue';
import ProjectHomeView from '../components/ProjectHomeView.vue';
import ProjectDetailView from '../components/ProjectDetailView.vue';

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/chat', component: ChatView },
  { path: '/marketplace', component: MarketplaceView },
  { path: '/projects', component: ProjectHomeView },
  { path: '/project/:id', component: ProjectDetailView },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
