# Luiz-Rifa

Pagina da rifa dos formandos com numeros de 2766 ate 2800, Pix copia e cola, QR Code Pix e confirmacao de pagamento por admin no Firebase.

## Firebase

1. Crie ou escolha um projeto no Firebase.
2. Ative Authentication com login anonimo e Google.
3. Crie o Cloud Firestore.
4. Cadastre um app Web no projeto e copie a configuracao para `firebase-config.js`.
5. Publique as regras:

```powershell
npx -y firebase-tools@latest deploy --only firestore:rules --project SEU_PROJECT_ID
```

6. Publique o site:

```powershell
npx -y firebase-tools@latest deploy --only hosting --project SEU_PROJECT_ID
```

## Fluxo de compra

1. O comprador escolhe os numeros.
2. A pagina gera Pix QR Code e copia e cola.
3. Depois de pagar, o comprador clica em "Ja paguei, enviar para conferencia".
4. O pedido vai para `orders` com status `pending`, sem gravar Pix copia e cola enviado pelo navegador.
5. O admin entra em `/admin.html`, confere no banco se o Pix caiu no CPF e confirma.
6. Somente depois da confirmacao os numeros viram documentos em `tickets` e aparecem como vendidos na pagina publica.

## Admin

O painel usa login Google. Entre uma vez em `/admin.html` com a conta Google que sera admin. Se aparecer "sem permissao", copie o UID mostrado na tela.

Depois, no Firestore, crie manualmente o documento:

```text
admins/UID_DO_ADMIN
```

Pode deixar um campo simples como `name: "Admin"`. As regras nao permitem que usuarios comuns criem admins pelo site.

Painel:

```text
/admin.html
```
