# Luiz-Rifa

Pagina da rifa dos formandos com numeros de 2766 ate 2800, Pix copia e cola, QR Code Pix e reserva protegida por Firebase.

## Firebase

1. Crie ou escolha um projeto no Firebase.
2. Ative Authentication com login anonimo.
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

Enquanto `firebase-config.js` estiver com os valores `COLE_AQUI`, a pagina continua abrindo, mas a reserva segura no banco fica desativada.
