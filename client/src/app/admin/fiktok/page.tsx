"use client";
import { useAdminMe } from '@/lib/admin';
export default function FiktokPage() {
  const me=useAdminMe();
  if(!me.data?.permissions.includes('media.manage'))return <section className="card" style={{padding:24}}>Fiktok Importer için yönetici yetkisi gerekiyor.</section>;
  return <section aria-label="Fiktok Importer"><iframe src="/fiktok-importer.html?admin=1" title="Fiktok Video Importer" style={{display:'block',width:'100%',height:'calc(100dvh - 135px)',minHeight:680,border:0,borderRadius:16,background:'#fff'}} allow="clipboard-write"/></section>;
}
