import { useEffect, useState } from 'react';
import Landing from './pages/Landing';
import Result from './pages/Result';

function getRoute(): { name: 'landing' } | { name: 'result'; id: string } {
  const path = window.location.pathname;
  const m = path.match(/^\/r\/([^/]+)/);
  if (m) return { name: 'result', id: m[1] };
  return { name: 'landing' };
}

export default function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route.name === 'result') return <Result id={route.id} />;
  return <Landing />;
}

export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
