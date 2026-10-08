import './style.css';
import { counter } from './counter';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <p>VexBoard scaffold — ${counter()}</p>
`;
