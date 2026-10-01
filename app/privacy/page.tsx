import React from 'react';
import Link from 'next/link';
import { IconArrowLeft } from '@/app/Icons';

export default function PrivacyPolicyPage() {
  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#18181b', color: '#fff', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
      <div style={{ maxWidth: 800, margin: '0 auto', background: '#27272a', padding: '40px', borderRadius: '12px' }}>
        <Link 
          href="/login" 
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a1a1aa', textDecoration: 'none', marginBottom: 32, fontSize: 14 }}
        >
          <IconArrowLeft size={16} /> Back / 戻る
        </Link>

        {/* English Version */}
        <div style={{ marginBottom: 64 }}>
          <h1 style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 24, borderBottom: '1px solid #3f3f46', paddingBottom: 16 }}>
            Privacy Policy
          </h1>

          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            {`Actlas (hereinafter referred to as "the Service") recognizes the importance of protecting users' personal information and will strive to handle and protect it appropriately in accordance with this Privacy Policy.`}
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            1. Information We Collect
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            We may collect the following information:
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}><strong>Account Information:</strong> Name, email address, password, etc.</li>
            <li style={{ marginBottom: 8 }}><strong>Service Usage Data:</strong> Chat history, lesson reservations, profile information, etc.</li>
            <li style={{ marginBottom: 8 }}><strong>Communication and Media Data:</strong> Audio/video data during video calls, text data (for AI translation and summarization features).</li>
            <li style={{ marginBottom: 8 }}><strong>Uploaded Files:</strong> Images, PDFs, and other materials shared between users.</li>
            <li style={{ marginBottom: 8 }}><strong>Payment Information:</strong> *Credit card information is processed and securely stored by third-party payment gateways (e.g., Stripe) and is not retained by the Service.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            2. How We Use the Information
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            We use the collected information for the following purposes:
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}>To provide and operate the Service (video calls, chat, reservation management, etc.).</li>
            <li style={{ marginBottom: 8 }}>To provide AI-powered automatic translation and lesson summarization features.</li>
            <li style={{ marginBottom: 8 }}>To process payments and communicate regarding billing.</li>
            <li style={{ marginBottom: 8 }}>To respond to user inquiries and provide support.</li>
            <li style={{ marginBottom: 8 }}>To monitor and prevent fraudulent activities or Terms of Service violations.</li>
            <li style={{ marginBottom: 8 }}>To analyze data for improving the Service and developing new features.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            3. Third-Party Provision and Integrations
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            {`We will not provide personal information to third parties without the user's consent, except as required by law. However, we may process data in integration with the following essential third-party services:`}
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}><strong>AI Analysis Features:</strong> We may send text/audio data to external APIs (e.g., OpenAI) to provide translation and summarization.</li>
            <li style={{ marginBottom: 8 }}><strong>Payment Processing:</strong> We use payment gateways like Stripe for secure payment processing.</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            4. Data Management and Security
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            We implement necessary and appropriate measures to prevent the leakage, loss, or damage of personal information. Server communications are encrypted using SSL/TLS.
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            5. Changes to the Privacy Policy
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            We may update this policy as necessary. Significant changes will be notified to users within the Service or via email.
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            6. Contact Us
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            For inquiries regarding this policy or requests to access, correct, or delete personal information, please contact the provider or support desk of the Service.
          </p>
        </div>

        {/* Japanese Version */}
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 24, borderBottom: '1px solid #3f3f46', paddingBottom: 16 }}>
            プライバシーポリシー（日本語）
          </h1>

          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            本サービス（Actlas）は、ユーザーの個人情報保護の重要性について認識し、個人情報の保護に関する法律（個人情報保護法）を遵守すると共に、以下のプライバシーポリシー（以下、「本ポリシー」といいます。）に従い、適切な取扱い及び保護に努めます。
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            1. 収集する情報
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            本サービスは、以下の情報を収集する場合があります。
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}><strong>アカウント情報：</strong>氏名、メールアドレス、パスワードなど</li>
            <li style={{ marginBottom: 8 }}><strong>サービス利用情報：</strong>チャット履歴、レッスン予約情報、プロフィール情報など</li>
            <li style={{ marginBottom: 8 }}><strong>通信およびメディアデータ：</strong>ビデオ通話の音声・映像データ、テキストデータ（AI翻訳・要約機能の利用のため）</li>
            <li style={{ marginBottom: 8 }}><strong>アップロードされたファイル：</strong>ユーザー間で共有された画像、PDFなどの教材データ</li>
            <li style={{ marginBottom: 8 }}><strong>決済に関する情報：</strong>※クレジットカード情報はStripeなどの決済代行会社で処理・保管され、本サービスでは保持しません。</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            2. 情報の利用目的
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            収集した情報は、以下の目的で利用いたします。
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}>本サービス（ビデオ通話、チャット、予約管理など）の提供および運営のため</li>
            <li style={{ marginBottom: 8 }}>AIを用いた自動翻訳、レッスン内容の自動要約機能の提供のため</li>
            <li style={{ marginBottom: 8 }}>利用料金の決済および関連する連絡のため</li>
            <li style={{ marginBottom: 8 }}>ユーザーからのお問い合わせへの対応、サポート提供のため</li>
            <li style={{ marginBottom: 8 }}>不正行為や利用規約違反の監視・防止のため</li>
            <li style={{ marginBottom: 8 }}>本サービスの機能改善や新機能開発のためのデータ分析のため</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            3. 第三者提供および外部連携
          </h2>
          <p style={{ marginBottom: 16, color: '#d4d4d8' }}>
            本サービスは、以下の場合を除き、ユーザーの同意を得ることなく第三者に個人情報を提供することはありません。ただし、サービスの提供に不可欠な以下の外部サービスと連携してデータを処理する場合があります。
          </p>
          <ul style={{ listStyleType: 'disc', paddingLeft: 24, marginBottom: 24, color: '#d4d4d8' }}>
            <li style={{ marginBottom: 8 }}><strong>AI解析機能：</strong>自動翻訳や要約を提供するため、OpenAI等の外部APIへテキスト・音声データを送信する場合があります。</li>
            <li style={{ marginBottom: 8 }}><strong>決済処理：</strong>Stripe等の決済代行サービスを利用し、安全に決済処理を行います。</li>
          </ul>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            その他、法令に基づく場合や、人の生命・財産の保護のために必要な場合は、例外的に情報を提供することがあります。
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            4. 情報の管理とセキュリティ
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            本サービスは、個人情報の漏洩、滅失または毀損の防止その他の個人情報の安全管理のために必要かつ適切な措置を講じます。サーバー通信はSSL/TLSによって暗号化されています。
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            5. プライバシーポリシーの変更
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            本サービスは、必要に応じて本ポリシーを変更することがあります。重要な変更がある場合は、本サービス内またはメール等でユーザーに通知します。
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 'bold', marginTop: 32, marginBottom: 16, color: '#fff' }}>
            6. お問い合わせ
          </h2>
          <p style={{ marginBottom: 24, color: '#d4d4d8' }}>
            本ポリシーに関するお問い合わせや、個人情報の開示・訂正・削除のご依頼については、本サービスの提供者または運営窓口までご連絡ください。
          </p>
        </div>

        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid #3f3f46', color: '#a1a1aa', fontSize: 14 }}>
          Last Updated / 制定日：June 18, 2026 (2026年6月18日)
        </div>
      </div>
    </div>
  );
}